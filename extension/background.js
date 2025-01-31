// monkey-patch before importing socket.io.js
self.addEventListener = (function (original) {
    return function (type, listener, options) {
        if (type === 'beforeunload') {
            console.warn('Ignoring \'beforeunload\' listener in service worker context.');
            return;
        }
        return original.call(self, type, listener, options);
    };
})(self.addEventListener);

importScripts('background/socket.io.js', 'background/livescratchProject.js', 'background/auth.js');

const getStorageValue = (key) => {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(key, (result) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve(result[key]);
            }
        });
    });
};

const getApiUrl = async () => {
    const customServer = await getStorageValue('custom-server');

    if (customServer) {
        const serverUrl = await getStorageValue('server-url');
        return serverUrl || 'https://blserver.waakul.com';
    }

    return 'https://blserver.waakul.com';
};

let apiUrl;

const loadUrl = () => {
    return new Promise(async (resolve, reject) => {
        try {
            apiUrl = await getApiUrl();
            resolve(); // Ensure this is final
        } catch (error) {
            console.error('Failed to get the API URL:', error);
            apiUrl = 'https://livescratchapi.waakul.com';
            reject(error); // Only reject on actual failure
        }
    });
};

loadUrl().then(()=>{
    backgroundScript();
})
    .catch((error)=>{
        console.error('Error loading server URL', error);
    });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.meta === 'getAPI-URL') {
        sendResponse({apiURL: apiUrl});
    }

    return true;
});

/// DECS
let uname = '*';
let upk = undefined;

chrome.runtime.onInstalled.addListener(async (details) => {
    let { apiUpdateReload } = await chrome.storage.local.get('apiUpdateReload'); // Destructure the result
    apiUpdateReload = await { apiUpdateReload }['apiUpdateReload'];
    console.log(apiUpdateReload);

    if (!!apiUpdateReload) {
        await chrome.storage.local.set({ 'apiUpdateReload': false });
        return;
    }

    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        chrome.tabs.create({ url: 'https://ko-fi.com/waakul' });
        chrome.tabs.create({ url: 'https://livescratch.waakul.com' });
    } else if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) {
        chrome.tabs.create({ url: 'https://livescratch.waakul.com' /* 'https://livescratch.waakul.com/new-release' */ });
    }
});


const LIVESCRATCH = {};
async function backgroundScript() {

    // user info
    // let username = 'ilhp10'

    // let apiUrl = 'http://127.0.0.1:4000'

    ////////// ACTIVE PROJECTS DATABASE //////////
    // blId -> [ports...]
    let livescratchTabs = {};
    // blId -> LivescratchProject
    let projects = {};
    // portName -> blId
    let portIds = {};

    let lastPortId = 0;
    let ports = [];

    let newProjects = {}; // tabId (or 'newtab') -> blId
    let tabCallbacks = {}; // tabId -> callback function

    function getProjectId(url) {
        if (projectsPageTester.test(url)) {
            let id = new URL(url).pathname.split('/')[2];
            // dont redirect if is not /projects/id/...
            if (isNaN(parseFloat(id))) {
                return null;
            } else {
                return id;
            }
        } else {
            return null;
        }
    }

    async function handleNewProject(tab) {
        let id = getProjectId(tab.url);
        if (!!id && tab.id in newProjects) {
            let blId = newProjects[tab.id];
            delete newProjects[tab.id];
            fetch(`${apiUrl}/linkScratch/${id}/${blId}/${uname}`, {
                method: 'PUT',
                headers: { authorization: currentBlToken },
            }); // link scratch project with api
            tabCallbacks[tab.id]({ meta: 'initLivescratch', blId }); // init livescratch in project tab
        }
    }

    const newProjectPage = 'https://scratch.mit.edu/create';
    async function prepRedirect(tab) {
        if (uname == '*') { return false; }importScripts('background/socket.io.js', 'background/livescratchProject.js', 'background/auth.js');
        let id = getProjectId(tab.url);


        // dont redirect if is not /projects/id/...
        if (!id) { return false; }
        let info = await (await fetch(apiUrl + `/userRedirect/${id}/${uname}`, { headers: { authorization: currentBlToken } })).json();
        // dont redirect if scratch id is not associated with ls project
        if (info.goto == 'none') { return false; }
        // dont redirect if already on project
        if (info.goto == id) { return false; }

        if (info.goto == 'new') {
            //register callbacks and redirect
            newProjects[tab.id] = info.lsId; //TODO: send this with api
            return newProjectPage;
        } else {
            if (tab.url.endsWith('editor') || tab.url.endsWith('editor/')) {
                return `https://scratch.mit.edu/projects/${info.goto}/editor`;
            } else {
                return `https://scratch.mit.edu/projects/${info.goto}`;
            }
        }
    }

    function playChange(blId, msg, optPort) {
    // record change
    //projects[blId]?.recordChange(msg)

        // send to local clients
        if (!!optPort) {
            livescratchTabs[blId]?.forEach((p => { try { if (p != optPort) { p.postMessage(msg); } } catch (e) { console.error(e); } }));
        } else {
            livescratchTabs[blId]?.forEach(p => { try { p.postMessage(msg); } catch (e) { console.log(e); } });
        }
    }

    //////// INIT SOCKET CONNECTION ///////
    // ['websocket', 'xhr-polling', 'polling', 'htmlfile', 'flashsocket']
    const URLApiUrl = new URL(apiUrl);
    const URLApiDomain = URLApiUrl.origin;
    const URLApiPath = [''].concat(URLApiUrl.pathname.split('/').filter(Boolean)).join('/');
    const socket = io.connect(URLApiDomain, { path: `${URLApiPath}/socket.io/`, jsonp: false, transports: ['websocket', 'xhr-polling', 'polling', 'htmlfile', 'flashsocket'] });
    LIVESCRATCH.socket = socket;
    // const socket = io.connect(apiUrl,{jsonp:false,transports:['websocket']})
    // socket.on("connect_error", () => { socket.io.opts.transports = ["websocket"];});
    console.log('connecting');
    socket.on('connect', async () => {
        console.log('connected with id: ', socket.id);
        ports.forEach(port => port.postMessage({ meta: 'resync' }));
        let blIds = Object.keys(livescratchTabs);
        if (blIds.length != 0) { socket.send({ type: 'joinSessions', username: await makeSureUsernameExists(), pk: upk, ids: blIds, token: currentBlToken }); }
    });
    socket.on('disconnect', () => {
        setTimeout(
            () => {
                if (ports.length != 0) {
                    socket.connect();
                }
            }, 600);
    });
    socket.on('connect_error', () => {
        setTimeout(() => {
            socket.connect();
        }, 1000);
    }); // copied from https://socket.io/docs/v3/client-socket-instance/
    socket.on('message', (data) => {
        console.log('message', data);
        if (data.type == 'projectChange') {
            if (data.version) { projects[data.blId]?.setVersion(data.version - 1); }
            data.msg.version = data.version;
            playChange(data.blId, data.msg);
        } else if (data.type == 'yourVersion') {
            projects[data.blId]?.setVersion(data.version);
        }
    });


    uname = (await chrome.storage.local.get(['uname'])).uname; // FIRST DEC
    upk = (await chrome.storage.local.get(['upk'])).upk; // FIRST DEC
    uname = uname ? uname : '*';
    upk = upk ? upk : undefined;


    let lastUnameRefresh = null;
    let signedin = true;
    async function refreshUsername(force) {
    // if(!force && uname!='*' && Date.now() - lastUnameRefresh < 1000 * 10) {return uname} // limit to refreshing once every 10 seconds
        lastUnameRefresh = Date.now();
        res = await fetch('https://scratch.mit.edu/session/?blreferer', {
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
            },
        });
        let json = await res.json();
        if (!json.user) {
            signedin = false;
            return uname;
        }
        signedin = true;
        uname = json.user.username;
        upk = json.user.id;
        chrome.storage.local.set({ uname, upk });
        await getCurrentBLTokenAfterUsernameRefresh?.();
        await testVerification();

        return uname;
    }
    LIVESCRATCH.refreshUsername = refreshUsername;

    async function testVerification() {
        try {
            let json = await (await fetch(`${apiUrl}/verify/test?username=${uname}`, { headers: { authorization: currentBlToken } })).json();
            if (!json.verified) {
                storeLivescratchToken(uname, null, true);
            }

        } catch (e) { console.error(e); }
    }

    async function makeSureUsernameExists() {
        if (uname == '*') {
            return refreshUsername();
        } else {
            return uname;
        }
    }
    refreshUsername();

    // Listen for Project load
    let projectsPageTester = new RegExp('https://scratch.mit.edu/projects/*.');
    chrome.tabs.onUpdated.addListener(async function (tabId, changeInfo, tab) {
        if (changeInfo.url?.startsWith('https://scratch.mit.edu/')) { refreshUsername(true); }
        if (changeInfo.url) {
            await makeSureUsernameExists();

            console.log('tab location updated', changeInfo, tab);

            let newUrl = await prepRedirect(tab);
            if (newUrl) {
                console.log('redirecting tab to: ' + newUrl, tab);
                chrome.tabs.update(tab.id, { url: newUrl });
            } else {
                handleNewProject(tab);
            }
        }
    },
    );

    // from chrome runtime documentation
    async function getCurrentTab() {
        let queryOptions = { active: true, lastFocusedWindow: true };
        // `tab` will either be a `tabs.Tab` instance or `undefined`.
        let [tab] = await chrome.tabs.query(queryOptions);
        return tab;
    }

    let userExistsStore = {};
    async function testUserExists(username) {
        username = username.toLowerCase();
        if (username in userExistsStore) {
            console.log(userExistsStore);
            return userExistsStore[username];
        } else {
            let res = await fetch(`${apiUrl}/userExists/${username}`);
            let answer = await res.json();
            console.log(answer);
            userExistsStore[username] = answer;

            return answer;
        }
    }



    // Connections to scratch editor instances
    chrome.runtime.onConnectExternal.addListener(function (port) {
        if (!socket.connected) { socket.connect(); }

        port.name = ++lastPortId;
        ports.push(port);

        let blId = '';
        // console.assert(port.name === "knockknock");
        port.onMessage.addListener(async function (msg) {
            console.log('isConnected', socket.connected);
            if (!socket.connected) {
                // messageOnConnect.push(msg)
                socket.connect();
            }

            console.log(msg);
            if (msg.meta == 'blockly.event' || msg.meta == 'sprite.proxy' || msg.meta == 'vm.blockListen' || msg.meta == 'vm.shareBlocks' || msg.meta == 'vm.replaceBlocks' || msg.meta == 'vm.updateBitmap' || msg.meta == 'vm.updateSvg' || msg.meta == 'version++') {
                let blIdd = portIds[port.name];

                msg.user = uname;
                playChange(blIdd, msg, port);

                // send to websocket
                socket.send({ type: 'projectChange', msg, blId: blIdd, token: currentBlToken, username: uname }, (res) => {
                    if (!!res) {
                        port.postMessage({ meta: 'yourVersion', version: res });
                    }
                });
            } else if (msg.meta == 'myId') {
                blId = msg.id;
                // record websocket id
                if (!(msg.id in livescratchTabs)) {
                    livescratchTabs[msg.id] = [];
                }
                if (port.name in portIds) { }
                else {
                    livescratchTabs[msg.id].push(port);
                    portIds[port.name] = msg.id;
                }

                // create project object
                if (!(msg.id in projects)) {
                    projects[msg.id] = new LivescratchProject();
                }
            } else if (msg.meta == 'joinSession') {
                await makeSureUsernameExists();
                socket.send({ type: 'joinSession', id: portIds[port.name], username: await makeSureUsernameExists(), pk: upk, token: currentBlToken });
            } else if (msg.meta == 'setTitle') {
                playChange(blId, msg, port);
                // send to websocket
                socket.send({ type: 'setTitle', blId, msg, token: currentBlToken, username: uname });
            } else if (msg.meta == 'chat') {
                playChange(blId, msg, port);
                // send to websocket
                socket.send({ type: 'chat', blId, msg, token: currentBlToken });
            } else if (msg.meta == 'chatnotif') {
                let tab = port.sender.tab;
                let notifs = (await chrome.storage.local.get(['notifs'])).notifs ?? false;
                console.log('notifs', notifs);
                if (notifs) {

                    chrome.notifications.create(null,
                        {
                            type: 'basic',
                            title: 'Livescratch Chat',
                            contextMessage: `${msg.sender} says in '${msg.project}':`,
                            message: msg.text,
                            // iconUrl:chrome.runtime.getURL('img/livescratchfullres.png'),
                            // iconUrl:msg.avatar,
                            // iconUrl:'https://assets.scratch.mit.edu/981e22b1b61cad530d91ea2cfd5ccec7.svg',
                            // iconUrl:'https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Red_Circle%28small%29.svg/2048px-Red_Circle%28small%29.svg.png'
                            iconUrl: 'img/livescratchfullres.png',
                            // isClickable:true,
                        },
                        (notif) => {
                            console.log('😱😱😱😱😱😱😱😱😱 DING DING NOTIFICATION', notif);
                            notificationsDb[notif] = { tab: tab.id, window: tab.windowId };
                            console.error(chrome.runtime.lastError);
                        },
                    );

                    if (!notifListenerAdded) {
                        chrome.notifications.onClicked.addListener(notif => {
                            chrome.tabs.update(notificationsDb[notif]?.tab, { selected: true });
                            chrome.windows.update(notificationsDb[notif]?.window, { focused: true });
                        });
                        notifListenerAdded = true;
                    }
                }
                // if(getCurrentTab()?.id!=tab?.id) {
                // }

            } else {
                msg.blId = blId ?? msg.blId;
                msg.token = currentBlToken;
                socket.send(msg);
            }

        });
        port.onDisconnect.addListener((p) => {
            console.log('port disconnected', p);
            ports.splice(ports.indexOf(p), 1);
            let livescratchId = portIds[p.name];
            let list = livescratchTabs[livescratchId];
            livescratchTabs[livescratchId].splice(list.indexOf(p), 1);
            delete portIds[p.name];
            setTimeout(() => {
                if (livescratchTabs[livescratchId].length == 0) { socket.send({ type: 'leaveSession', id: livescratchId }); }
                if (ports.length == 0) { socket.disconnect(); } // Todo: handle disconnecting and reconnecting backend socket
            }, 5000); // leave socket stuff if page doesnt reconnect in 5 seconds
        });
    });
    var notificationsDb = {};
    var notifListenerAdded = false;

    // Proxy project update messages
    chrome.runtime.onMessageExternal.addListener(
        function (request, sender, sendResponse) {
            (async () => {
                console.log('external message:', request);
                if (request.meta == 'getBlId') {
                    if (!request.scratchId || request.scratchId == '.') { return ''; }
                    sendResponse((await (await fetch(`${apiUrl}/lsId/${request.scratchId}/${uname}`, { headers: { authorization: currentBlToken } })).text()).replaceAll('"', ''));
                    // } else if(request.meta =='getInpoint') {
                    //   sendResponse(await (await fetch(`${apiUrl}/projectInpoint/${request.blId}`)).json())
                } else if (request.meta == 'getJson') {
                    try {
                        sendResponse(await (await fetch(`${apiUrl}/projectJSON/${request.blId}?username=${uname}`, { headers: { authorization: currentBlToken } })).json());
                    } catch (e) { sendResponse({ err: 'livescratch id does not exist' }); }
                } else if (request.meta == 'getChanges') {
                    sendResponse(await (await fetch(`${apiUrl}/changesSince/${request.blId}/${request.version}`, { headers: { authorization: currentBlToken, uname } })).json());
                } else if (request.meta == 'getUsername') {
                    sendResponse(uname);
                } else if (request.meta == 'getUsernamePlus') {
                    console.log('sending response');
                    console.log({ uname, signedin, currentBlToken, apiUrl});
                    sendResponse({ uname, signedin, currentBlToken, apiUrl});
                } else if (request.meta == 'callback') {
                    tabCallbacks[sender.tab.id] = sendResponse;
                } else if (request.meta == 'projectSaved') {
                    // {meta:'projectSaved',blId,scratchId,version:blVersion}
                    fetch(`${apiUrl}/projectSaved/${request.scratchId}/${request.version}`, { method: 'POST', headers: { authorization: currentBlToken } });
                } else if (request.meta == 'projectSavedJSON') {
                    // {meta:'projectSaved',blId,scratchId,version:blVersion}
                    fetch(`${apiUrl}/projectSavedJSON/${request.blId}/${request.version}`, { method: 'POST', body: request.json, headers: { 'Content-Type': 'application/json', authorization: currentBlToken, uname } });
                } else if (request.meta == 'myStuff') {
                    sendResponse(await (await fetch(`${apiUrl}/userProjectsScratch/${await makeSureUsernameExists()}`, { headers: { authorization: currentBlToken } })).json());
                } else if (request.meta == 'create') {
                    // sendResponse(await(await fetch(`${apiUrl}/newProject/${request.scratchId}/${await refreshUsername()}?title=${encodeURIComponent(request.title)}`)).json())
                    sendResponse(await (await fetch(`${apiUrl}/newProject/${request.scratchId}/${await refreshUsername()}?title=${encodeURIComponent(request.title)}`,
                        {
                            method: 'POST',
                            body: request.json,
                            headers: { 'Content-Type': 'application/json', authorization: currentBlToken },
                        }).then(res => res.json()).catch(e => ({ err: e.toString() }))));
                } else if (request.meta == 'shareWith') {
                    let response = await fetch(`${apiUrl}/share/${request.id}/${request.username}/${uname}?pk=${request.pk}`, {
                        method: 'PUT',
                        headers: { authorization: currentBlToken },
                    });
                    let statusCode = await response.status;
                    sendResponse(statusCode);
                } else if (request.meta == 'unshareWith') {
                    fetch(`${apiUrl}/unshare/${request.id}/${request.user}`, {
                        method: 'PUT',
                        headers: { authorization: currentBlToken, uname },
                    });
                } else if (request.meta == 'getShared') {
                    sendResponse(await (await fetch(`${apiUrl}/share/${request.id}`, { headers: { authorization: currentBlToken, uname } })).json());
                } else if (request.meta == 'getTitle') {
                    sendResponse((await (await fetch(`${apiUrl}/projectTitle/${request.blId}`, { headers: { authorization: currentBlToken, uname } })).json()).title);
                } else if (request.meta == 'leaveScratchId') {
                    fetch(`${apiUrl}/leaveScratchId/${request.scratchId}/${await refreshUsername()}`, {
                        method: 'PUT',
                        headers: { authorization: currentBlToken },
                    });
                } else if (request.meta == 'leaveLSId') {
                    fetch(`${apiUrl}/leaveLSId/${request.blId}/${await refreshUsername()}`, {
                        method: 'PUT',
                        headers: { authorization: currentBlToken },
                    });
                } else if (request.meta == 'getActive') {
                    sendResponse(await (await fetch(`${apiUrl}/active/${request.id}`, { headers: { authorization: currentBlToken, uname } })).json());
                } else if (request.meta == 'getUrl') {
                    sendResponse(await chrome.runtime.getURL(request.for));
                } else if (request.meta == 'isPingEnabled') {
                    sendResponse((await chrome.storage.local.get(['ping'])).ping);
                } else if (request.meta == 'userExists') {
                    sendResponse(await testUserExists(request.username));
                }  else if (request.meta == 'badges?') {
                    sendResponse({badges:(await chrome.storage.local.get(['badges'])).badges});
                } 
            })();
            return true;
        });


    chrome.runtime.onMessage.addListener(async function (request, sender, sendResponse) {
        if (request.meta == 'getUsername') {
            sendResponse(uname);
        } else if (request.meta == 'getUsernamePlus') {
            sendResponse({ uname, signedin, currentBlToken, apiUrl});
            refreshUsername();
        }
    });
}