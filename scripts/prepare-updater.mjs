import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {URL} from 'node:url';
import JSZip from 'jszip';
const zip = new JSZip();
for (const name of ['install.ps1', 'updater.ps1', 'NativeHost.cs']) zip.file(name, await readFile(new URL('./updater/' + name, import.meta.url)));
await mkdir(new URL('../public/', import.meta.url), {recursive: true});
await writeFile(new URL('../public/siftmark-windows-updater.zip', import.meta.url), await zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE'}));
