

document.querySelector("button.viewall").addEventListener("click", function() {
    chrome.tabs.create({
        url: "/projects/index.html"
    })
})

chrome.runtime.sendMessage({meta:"getUsernamePlus"},function(info){
    let username = info.uname
    let token = info.currentBlToken
    let apiUrl = info.apiUrl


    function setSignedin(info) {

    if(info.signedin) {
        document.querySelector('#loggedout').style.display = 'none'
        document.querySelector('#normal').style.display = 'unset'
        token = info.currentBlToken;
        username = info.uname
    } else {
        document.querySelector('#loggedout').style.display = 'unset'
        document.querySelector('#normal').style.display = 'none'
    }
    }
    setSignedin(info)

setTimeout(()=>{chrome.runtime.sendMessage({meta:"getUsernamePlus"},setSignedin)},1000)

    document.querySelector('#listtitle').innerHTML = sanitize(username) + "'s Friends&nbsp;List"


    let alreadyAdded = {}

// credit https://stackoverflow.com/questions/2794137/sanitizing-user-input-before-adding-it-to-the-dom-in-javascript
    function sanitize(string) {
        string = String(string)
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;',
            "/": '&#x2F;',
        };
        const reg = /[&<>"'/]/ig;
        return string.replace(reg, (match)=>(map[match]));
      }


    function addFriendGUI(name) {
        console.log(name)
        if(name?.toLowerCase() in alreadyAdded) {return}
        alreadyAdded[name.toLowerCase()] = true

        let item = document.createElement('li')
        item.username = name
        item.innerHTML = `<span class="friend-name" >@${sanitize(name)}</span>  <span class="x" href="page2.html">x</span>`;
        item.onclick=(e)=>{
            if(e.target?.classList?.contains('x')) {removeFriend(name)}
            else {chrome.tabs.create({url: `https://scratch.mit.edu/users/${name}`});}
        }
       
        document.querySelector('#friends').appendChild(item)
    }

    function addFriend(name) {
        if(name.toLowerCase() in alreadyAdded) {return}
        if(name.toLowerCase() == username.toLowerCase()) {return}
        if(!name.trim()) {return}
        if(name.includes(' ')) {return}
        document.querySelector('#searchh').value = ''
        addFriendGUI(name)
        fetch(`${apiUrl}/friends/${username}/${name}`,{method:"POST",headers:{authorization:token}});
    }

    function removeFriend(name) {
        delete alreadyAdded[name.toLowerCase()]
        for(let child of document.querySelector('#friends').children) {
            if(child.username == name) {child.remove(); break;}
        }
        fetch(`${apiUrl}/friends/${username}/${name}`,{method:"DELETE",headers:{authorization:token}});
    }

    document.querySelector('#searchh').addEventListener("keyup", function(event) {
        if (event.keyCode === 13) {
            addFriend(document.querySelector('#searchh').value)
        }
    });
    document.querySelector('#submit').onclick = ()=>{addFriend(document.querySelector('#searchh').value)}
    let unverified = document.getElementById('unverified');
    if(info.currentBlToken) { unverified.style.display = 'none'}
    else {unverified.style.display = 'inherit'}
    if(!info.currentBlToken && !info.verifyBypass) {
        showNoAuthMessage()
    } else {
        // populate with current friends
        fetch(`${apiUrl}/friends/${username}`,{headers:{authorization:token}})
            .then((res)=>{document.querySelector('#friends').innerHTML = '';return res})
            .then(res=>res.json().then(list=>{
                if(list.noauth) {showNoAuthMessage()}
                else {list.forEach(addFriendGUI)}
            }))
            .catch((e)=>{
                document.querySelector('#friends').innerHTML = `<span class="requestError" style="color:red;"><span>Request Error :( <br><br>${e.stack.replace(new RegExp(`chrome-extension://${chrome.runtime.id}/`,'g'),'')}</span><span>`;
            })
    }
});

function showNoAuthMessage() {
    document.querySelector('#friends').innerHTML = `<div style="color:red; text-align:center; font-size: medium; padding:10px; justify-self:center;"><span style="background:white;">You're not verified with blocklive. <br> <br> To verify, open scratch in a new tab and wait for 10 seconds. <br><br> If you're still not verified, contact @ilhp10 or @rgantzos </span></div>`

}

document.getElementById('discord').onclick = ()=>{
    chrome.tabs.create({url: `https:\/\/discord.gg/9ZQQhvAvqp`});
}
document.getElementById('uptime').onclick = ()=>{
    chrome.tabs.create({url: `https://status.uptime-monitor.io/6499c89d4bfb79bb5f20ac4d`});
}
document.getElementById('support').onclick = ()=>{
    chrome.tabs.create({url: `https://www.buymeacoffee.com/ilhp10`});
}
document.getElementById('rgantzos').onclick = ()=>{
    chrome.tabs.create({url: `https://scratch.mit.edu/users/rgantzos`});
}
document.getElementById('ilhp10').onclick = ()=>{
    chrome.tabs.create({url: `https://scratch.mit.edu/users/ilhp10`});
}

/// request permissions
(async()=>{
document.querySelector('#notifs').checked = (await chrome.storage.local.get(['notifs']))?.notifs ?? false
})()
document.querySelector('#notifs').addEventListener('change', (event) => {
    let on = event.currentTarget.checked;
    chrome.storage.local.set({notifs:on})
    // Permissions must be requested from inside a user gesture, like a button's
    // click handler.
    chrome.permissions.request({
      permissions: ['notifications'],
    }, (granted) => {
      // The callback argument will be true if the user granted the permissions.
      if (granted) {
        // doSomething();
      } else {
        chrome.storage.local.set({notifs:false})
        document.querySelector('#notifs').checked = false;
      }
    });
  });
  

  /// request permissions
(async()=>{
    document.querySelector('#ping').checked = (await chrome.storage.local.get(['ping']))?.ping ?? false
    })()
    document.querySelector('#ping').addEventListener('change', (event) => {
        let on = event.currentTarget.checked;
        chrome.storage.local.set({ping:on})
        // Permissions must be requested from inside a user gesture, like a button's
        // click handler.

      });
      

  

let logo = document.getElementById('logo')
document.addEventListener('mousemove',(e)=>{
    logo.style.transform = (e.pageX > 190 && e.pageY < 137) ? `rotate(360deg)` : `rotate(0deg)`
})