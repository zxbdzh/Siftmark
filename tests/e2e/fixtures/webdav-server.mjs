import {createServer} from 'node:http';
import {Buffer} from 'node:buffer';
import {randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv} from 'node:crypto';
import console from 'node:console';

// 仅供本机实机验收：数据只驻留内存，日志不输出书签、笔记或模型配置。
const port = 53219;
const password = 'siftmark-local-test-encryption-2026';
const authorization = 'Basic ' + Buffer.from('tester:temporary-password').toString('base64');
const files = new Map(); let revision = 0; let unavailable = false;
const fileName = '/dav/siftmark-sync.v1.encrypted';
function decode(bytes) {
  const length = bytes.readUInt32BE(8), headerBytes = bytes.subarray(12, 12 + length), header = JSON.parse(headerBytes.toString());
  const encrypted = bytes.subarray(12 + length), key = pbkdf2Sync(password, Buffer.from(header.salt,'base64'), header.iterations,32,'sha256');
  const cipher = createDecipheriv('aes-256-gcm',key,Buffer.from(header.nonce,'base64'));cipher.setAAD(headerBytes);cipher.setAuthTag(encrypted.subarray(-16));
  return JSON.parse(Buffer.concat([cipher.update(encrypted.subarray(0,-16)),cipher.final()]).toString());
}
function encode(document) {
  const header={magic:'SIFTMARK',version:1,cipher:'AES-256-GCM',kdf:'PBKDF2-SHA-256',iterations:600000,salt:randomBytes(16).toString('base64'),nonce:randomBytes(12).toString('base64')};
  const headerBytes=Buffer.from(JSON.stringify(header)),prefix=Buffer.alloc(12);prefix.write('SIFTMARK');prefix.writeUInt32BE(headerBytes.length,8);
  const cipher=createCipheriv('aes-256-gcm',pbkdf2Sync(password,Buffer.from(header.salt,'base64'),600000,32,'sha256'),Buffer.from(header.nonce,'base64'));cipher.setAAD(headerBytes);
  return Buffer.concat([prefix,headerBytes,cipher.update(JSON.stringify(document)),cipher.final(),cipher.getAuthTag()]);
}
const server=createServer(async(req,res)=>{
  const send=(status,body='')=>{res.statusCode=status;res.end(body);};
  try {
    if (req.url==='/health') return send(200,JSON.stringify({files:files.size,revision}));
    if (req.headers.authorization!==authorization) return send(401);
    if(req.url.startsWith('/_test/')) {
      if(req.url==='/_test/offline'){unavailable=true;return send(200,'ok');}
      if(req.url==='/_test/online'){unavailable=false;return send(200,'ok');}
      if(req.url==='/_test/add-sample') {
        const document=decode(files.get(fileName).bytes);
        document.entries['bookmark:bookmark-live-folder']={kind:'bookmark',key:'bookmark-live-folder',value:{parentId:'root-1',index:0,title:'Siftmark 同步验收（临时副本）'}};
        document.entries['bookmark:bookmark-live-sample']={kind:'bookmark',key:'bookmark-live-sample',value:{parentId:'bookmark-live-folder',index:0,title:'WebDAV 云端验收书签',url:'https://siftmark-sync.invalid/verified'}};
        document.entries['record:bookmarkMetadata:bookmark-live-sample']={kind:'record',table:'bookmarkMetadata',key:'bookmark-live-sample',value:{bookmarkId:'@bookmark:bookmark-live-sample',note:'云端笔记已随原生书签同步',summary:'',tags:[],confidence:'unknown',reason:'',health:'unchecked',createdAt:1,updatedAt:1}};
        files.set(fileName,{bytes:encode(document),etag:'"'+(++revision)+'"'});return send(200,JSON.stringify({added:3}));
      }
      return send(404);
    }
    if(unavailable) return send(503);
    const file=files.get(req.url);
    if(req.method==='GET') {if(!file)return send(404);res.setHeader('ETag',file.etag);res.setHeader('Content-Length',file.bytes.length);return send(200,file.bytes);}
    if(req.method==='PUT') {
      if(req.headers['if-none-match']==='*'&&file || req.headers['if-match']&&file?.etag!==req.headers['if-match'])return send(412);
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>64*1024*1024)return send(413);chunks.push(chunk);}
      const etag='"'+(++revision)+'"';files.set(req.url,{bytes:Buffer.concat(chunks),etag});res.setHeader('ETag',etag);return send(201);
    }
    if(req.method==='DELETE'){if(req.headers['if-match']&&file?.etag!==req.headers['if-match'])return send(412);files.delete(req.url);return send(204);}
    send(405);
  }catch {send(500,'Local verification fixture failed');}
});
server.listen(port,'127.0.0.1',()=>console.log('WebDAV verification fixture listening on http://127.0.0.1:'+port));
