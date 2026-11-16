// Cloudflare Worker - Upstyle Catalogue V2
// Secrets à configurer : ADMIN_KEY, GITHUB_TOKEN
// Variables : GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH (main par défaut)
// Le token GitHub doit avoir accès au dépôt et le droit Contents: Read and write.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response("", {headers:cors});
    if (request.headers.get("X-Admin-Key") !== env.ADMIN_KEY)
      return new Response("Accès refusé", {status:401,headers:cors});

    const u = new URL(request.url);
    try {
      if (u.pathname === "/products" && request.method === "GET") {
        const data = await ghGet(env, "produits.json");
        return json(JSON.parse(atobUnicode(data.content)), 200);
      }

      if (u.pathname === "/product" && request.method === "POST") {
        const form = await request.formData();
        const p = JSON.parse(form.get("product"));
        const currentFile = await ghGet(env, "produits.json");
        const products = JSON.parse(atobUnicode(currentFile.content));
        const files = form.getAll("photos").filter(x => x && x.size);

        if (files.length) {
          // Supprime les anciennes références de la fiche ; les anciens fichiers peuvent rester dans GitHub.
          p.photos = [];
          for (let i=0; i<Math.min(files.length,5); i++) {
            const f = files[i];
            const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g,"");
            const filename = `photos/${p.id}-${i+1}.${ext}`;
            const b64 = arrayBufferToBase64(await f.arrayBuffer());
            let existing = null; try { existing = await ghGet(env, filename); } catch {}
            await ghPut(env, filename, b64, `Photo ${p.nom}`, existing?.sha);
            p.photos.push(filename);
          }
        }

        const idx = products.findIndex(x => x.id === p.id);
        if (idx >= 0) products[idx] = p; else products.unshift(p);
        await ghPut(env, "produits.json", btoaUnicode(JSON.stringify(products,null,2)), `Catalogue: ${p.nom}`, currentFile.sha);
        return json({ok:true,product:p},200);
      }

      if (u.pathname.startsWith("/product/") && request.method === "DELETE") {
        const id = decodeURIComponent(u.pathname.slice("/product/".length));
        const currentFile = await ghGet(env, "produits.json");
        const products = JSON.parse(atobUnicode(currentFile.content));
        const next = products.filter(x => x.id !== id);
        await ghPut(env, "produits.json", btoaUnicode(JSON.stringify(next,null,2)), `Suppression produit ${id}`, currentFile.sha);
        return json({ok:true},200);
      }

      return new Response("Not found",{status:404,headers:cors});
    } catch(e) {
      return new Response(String(e.message || e), {status:500,headers:cors});
    }
  }
};

function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:{...cors,"Content-Type":"application/json"}})}
function cfg(env){return {owner:env.GITHUB_OWNER,repo:env.GITHUB_REPO,branch:env.GITHUB_BRANCH||"main"}}
async function ghGet(env,path){
  const c=cfg(env);
  const r=await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(c.branch)}`,{headers:ghHeaders(env)});
  if(!r.ok) throw new Error(`GitHub GET ${path}: ${r.status} ${await r.text()}`);
  return await r.json();
}
async function ghPut(env,path,content,message,sha){
  const c=cfg(env), body={message,content,branch:c.branch}; if(sha) body.sha=sha;
  const r=await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}/contents/${encodePath(path)}`,{method:"PUT",headers:{...ghHeaders(env),"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok) throw new Error(`GitHub PUT ${path}: ${r.status} ${await r.text()}`);
  return await r.json();
}
function ghHeaders(env){return {"Authorization":`Bearer ${env.GITHUB_TOKEN}`,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"Upstyle-Catalogue-Admin"}}
function encodePath(p){return p.split("/").map(encodeURIComponent).join("/")}
function arrayBufferToBase64(buf){let s="",b=new Uint8Array(buf);for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s)}
function btoaUnicode(s){return btoa(unescape(encodeURIComponent(s)))}
function atobUnicode(s){return decodeURIComponent(escape(atob(s.replace(/\n/g,""))))}
