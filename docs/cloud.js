// The public Pages demo uses the fixed hosted API; no credentials enter the browser.
(() => {
 if(location.protocol!=='file:'&&location.hostname!=='kyuhank.github.io')return;
 const base='https://tgusnkwvfzwdeufzevhk.supabase.co/functions/v1/workshop-api',native=window.fetch.bind(window);
 window.fetch=(input,options)=>{const value=String(input);return native(value.startsWith('/api/')?base+value:value,options);};
 window.addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='cpue-view-active'){window.workshopActive=e.data.active;}});
})();
