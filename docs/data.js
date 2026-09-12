const $=id=>document.getElementById(id);
let snapshot=null,table='sets',page=0,ticket=0;
const pageSize=100,columns={sets:['Set ID','Year','Vessel','Hooks','Catch (number)'],removals:['Year','Catch (tonnes)']};
function draw(){
 if(!snapshot)return;
 const term=$('filter').value.trim().toLowerCase(),all=snapshot[table]||[],rows=term?all.filter(row=>row.some(v=>String(v).toLowerCase().includes(term))):all;
 page=Math.min(page,Math.max(0,Math.ceil(rows.length/pageSize)-1));
 const heading=document.createElement('tr');for(const name of columns[table]){const th=document.createElement('th');th.textContent=name;heading.append(th);}$('head').replaceChildren(heading);
 $('rows').replaceChildren(...rows.slice(page*pageSize,(page+1)*pageSize).map(values=>{const row=document.createElement('tr');for(const [index,value] of values.entries()){const cell=document.createElement('td');cell.textContent=(table==='sets'&&index===1)||(table==='removals'&&index===0)?String(value):typeof value==='number'?value.toLocaleString('en',{maximumFractionDigits:3}):value;row.append(cell);}return row;}));
 $('range').textContent=rows.length?`${(page*pageSize+1).toLocaleString('en')}–${Math.min(rows.length,(page+1)*pageSize).toLocaleString('en')} of ${rows.length.toLocaleString('en')} records`:'No matching records';
 $('previous').disabled=page===0;$('next').disabled=(page+1)*pageSize>=rows.length;
}
async function load(version=''){
 const request=++ticket;$('error').hidden=true;$('version').disabled=true;
 try{
  const response=await fetch('/api/database'+(version?'?version='+encodeURIComponent(version):''),{cache:'no-store'}),result=await response.json();
  if(!response.ok)throw Error(result.detail||'The database view is unavailable.');if(request!==ticket)return;
  snapshot=result.snapshot;page=0;
  $('source').textContent=result.provider+' · Database snapshot v'+snapshot.version;
  $('counts').textContent=snapshot.sets.length.toLocaleString('en')+' sets · '+snapshot.removals.length+' annual catch records';
  $('version').replaceChildren(...[2023,...(result.current_version>=2024?[2024]:[])].map(value=>{const option=document.createElement('option');option.value=value;option.textContent='v'+value;return option;}));$('version').value=snapshot.version;$('version').disabled=false;
  const url=new URL(location.href);url.searchParams.set('version',snapshot.version);history.replaceState(null,'',url);draw();
 }catch(error){const link=document.createElement('a');link.href='./data.html';link.textContent='Open current snapshot ↗';$('error').replaceChildren(document.createTextNode(error.message+' '),link);$('error').hidden=false;$('source').textContent='Database connection unavailable';}
}
for(const button of document.querySelectorAll('[data-table]'))button.onclick=()=>{table=button.dataset.table;page=0;document.querySelectorAll('[data-table]').forEach(el=>el.classList.toggle('active',el===button));draw();};
$('filter').oninput=()=>{page=0;draw();};$('version').onchange=()=>load($('version').value);
$('previous').onclick=()=>{page--;draw();};$('next').onclick=()=>{page++;draw();};
load(new URLSearchParams(location.search).get('version')||'');
