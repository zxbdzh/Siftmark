using System;
using System.IO;
using System.Diagnostics;
using System.Text;
using System.Web.Script.Serialization;
using System.Collections.Generic;

// 标准输入输出仅用于 Chrome 消息帧，诊断不能混入 stdout。
public static class NativeHost {
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  static byte[] Read(Stream stream, int length) {
    var bytes = new byte[length]; int used = 0;
    while (used < length) {int count = stream.Read(bytes, used, length-used); if (count == 0) throw new EndOfStreamException(); used += count;}
    return bytes;
  }
  public static int Main(string[] args) {
    try {
      string root = AppDomain.CurrentDomain.BaseDirectory;
      var config = Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(root, "config.json"), Encoding.UTF8));
      string origin = "chrome-extension://" + (string)config["extensionId"] + "/";
      if (args.Length == 0 || args[0] != origin) throw new Exception("Extension origin is not authorized");
      Stream input = Console.OpenStandardInput(); uint size = BitConverter.ToUInt32(Read(input,4),0);
      if (size < 2 || size > 4096) throw new Exception("Invalid native message length");
      var request = Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(Read(input,(int)size)));
      string action = request.ContainsKey("action") ? request["action"] as string : null;
      if (action != "check" && action != "apply" && action != "ack" && action != "rollback" && action != "status") throw new Exception("Unsupported updater action");
      var process = new Process();
      process.StartInfo = new ProcessStartInfo {
        FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
        Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + Path.Combine(root, "updater.ps1") + "\" -Action " + action,
        UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
        StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
      };
      process.Start();
      var output = process.StandardOutput.ReadToEndAsync(); var errors = process.StandardError.ReadToEndAsync();
      if (!process.WaitForExit(120000)) {process.Kill(); throw new Exception("Updater timed out; previous files preserved");}
      string result = output.Result.Trim();
      if (result.Length == 0) throw new Exception(errors.Result.Length > 0 ? errors.Result : "Updater did not return a response");
      // 校验失败的 JSON 也须原样传回扩展，保留可操作的失败原因。
      Json.DeserializeObject(result); Write(result); return 0;
    } catch(Exception error) {Write(Json.Serialize(new {ok=false, error=error.Message})); return 1;}
  }
  static void Write(string text) {
    byte[] bytes = Encoding.UTF8.GetBytes(text); Stream output = Console.OpenStandardOutput();
    output.Write(BitConverter.GetBytes((uint)bytes.Length),0,4); output.Write(bytes,0,bytes.Length); output.Flush();
  }
}
