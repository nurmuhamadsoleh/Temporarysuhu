import http from 'node:http';import fs from 'node:fs/promises';
const files={'/':'index.html','/bundle.js':'bundle.js','/styles.css':'styles.css'};
http.createServer(async(req,res)=>{const file=files[req.url];if(!file){res.writeHead(404);res.end();return;}try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/javascript');res.end(await fs.readFile(new URL(file,import.meta.url)));}catch{res.writeHead(500);res.end();}}).listen(3219,'127.0.0.1',()=>console.log('Offline UI fixture: 127.0.0.1:3219'));
