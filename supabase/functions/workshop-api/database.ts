export async function rpc(name:string,body:unknown={}){
 const base=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!base||!key)throw Error('Database is not configured.');
 const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Database operation was not accepted.');
 const text=await r.text();return text?JSON.parse(text):null;
}
export async function cached(key:string,seconds:number,load:()=>Promise<any>){
 const old=await rpc('workshop_cache_get',{p_key:key});if(old!==null)return old;
 const value=await load();await rpc('workshop_cache_put',{p_key:key,p_value:value,p_seconds:seconds});return value;
}
export async function invalidate(){await Promise.all(['status','branches'].map(p_key=>rpc('workshop_cache_put',{p_key,p_value:{},p_seconds:0})));}
