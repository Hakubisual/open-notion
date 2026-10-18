(function(){
if(!window.AcardEditor&&!window.AcardReader)return;
var pending,prefix=0;
function run(key){
if(!pending)pending=window.AcardEditor?AcardEditor.lazy("quick-note"):new Promise(function(ok,fail){var s=document.createElement("script");s.src="/lazy/quick-note.js";s.onload=function(){ok(window.AcardQuickNote)};s.onerror=fail;document.head.appendChild(s)});
pending.then(function(api){api.run(key)}).catch(function(){pending=null;alert("연결을 확인해 주세요.")})
}
document.addEventListener("click",function(e){if(e.target.closest("#quick-note-open"))run("q")});
document.addEventListener("keydown",function(e){
if(e.defaultPrevented||e.isComposing||e.repeat||e.ctrlKey||e.metaKey||e.altKey||e.target.isContentEditable||e.target.closest("input,textarea,select")){prefix=0;return}
var key=e.key,go=prefix&&e.timeStamp-prefix<1200;prefix=key==="g"?e.timeStamp:0;
if(go&&/^[ht]$/.test(key))key="g"+key;
if(/^(\/|k|n|q|\?|gh|gt)$/.test(key)){e.preventDefault();run(key)}
})})();
