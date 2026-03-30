console.log('injecting editor.js');

// alert(chrome.runtime.id)
let scriptElem = document.createElement('script');
scriptElem.dataset.exId = chrome.runtime.id;
scriptElem.classList.add('livescratch-ext');
let srcThign = chrome.runtime.getURL('/scripts/editor.js');

scriptElem.src = srcThign;
// document.body.append(scriptElem)

if (!!document.head) {
    document.head.appendChild(scriptElem);
} else {
    document.documentElement.appendChild(scriptElem);
}
