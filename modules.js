(()=>{
 function reveal(target){if(!target)return;for(let node=target;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;}
 window.openAtelierSection=id=>reveal(document.getElementById(id));
 function revealHash(){if(!location.hash)return;let id;try{id=decodeURIComponent(location.hash.slice(1));}catch{return;}reveal(document.getElementById(id));}
 document.addEventListener('click',event=>{const link=event.target.closest('a[href^="#"]');if(link)reveal(document.getElementById(link.getAttribute('href').slice(1)));});
 window.addEventListener('hashchange',revealHash);
 revealHash();
})();
