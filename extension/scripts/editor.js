console.log('CollabLive Editor Inject Running...')
apiUrl = 'https://spore.us.to:4000'
// apiUrl = 'http://localhost:4000'


// get exId
const exId = document.querySelector(".blocklive-ext").dataset.exId

chrome.runtime.sendMessage(exId,{meta:'getUsernamePlus'},(userData)=>{apiUrl = userData.apiUrl})

//////////// TRAP UTILS ///////////

function sleep(millis) {
    return new Promise(res=>setTimeout(res,millis));
}
let revertJSON = null;
let queryList = []
let bl_projectId = null
store = null
let playAfterDragStop = []
let finishedSavingCB = []
function mutationCallback() {
    if(typeof BL_UTILS == 'object'){
        if(!BL_UTILS.isDragging() && playAfterDragStop.length > 0) {
            playAfterDragStop.forEach(msg=>{blockliveListener(msg)})
            playAfterDragStop = []
        }
    }
    if(bl_projectId && store?.getState().preview.projectInfo.id != bl_projectId) {location.reload()}
    bl_projectId = store?.getState().preview.projectInfo.id;
    let toDelete = []
    queryList.forEach(query=>{
        let elem = document.querySelector(query.query)
        if(elem && !elem.blSeen) {
            if(query.once){toDelete.push(query)}
            else {elem.blSeen = true}
            query.callback(elem)
        }
    })
    toDelete.forEach(query=>{queryList.splice(queryList.indexOf(query),1)})
}
let observer = new MutationObserver(mutationCallback)
observer.observe(document.documentElement,{ subtree: true, childList: true })
function getObj(query) {
    let obj = document.querySelector(query)
    if(obj) {return new Promise(res=>{res(obj)})}
    return new Promise(res=>{
        queryList.push({query,callback:res,once:true})
    })
}
function listenForObj(query,callback) {
    let obj = document.querySelector(query)
    if(obj) {obj.blSeen = true; callback(obj)}
    queryList.push({query,callback,once:false})
}

function waitFor(lambda) {
    return new Promise(async res=>{
        let output;
        while(!(output = lambda())) {
            // console.log('waiting for lambda resolve: ' + lambda)
            await sleep(100)
        }
        res(output);
    })
}



///.......... BG SCRIPT CONNECTION SETUP ..........//

// Connect To Background Script
// var port = chrome.runtime.connect(exId);
var port
var isConnected = false;

function liveMessage(message,res) {
    if(blockliveDeleted) {return}
    reconnectIfNeeded()
    let msg = message
    if(msg.meta=="blockly.event" || msg.meta=="sprite.proxy"||msg.meta=="vm.blockListen"||msg.meta=="vm.shareBlocks" ||msg.meta=="vm.replaceBlocks" ||msg.meta=="vm.updateBitmap"||msg.meta=="vm.updateSvg" ||msg.meta=="version++") {
        blVersion++
    }
    port.postMessage(message,res)
}

let blockliveListener

let registerChromePortListeners = ()=> {
    if(blockliveDeleted) {return}
    port.onMessage.addListener((...args)=>{blockliveListener(...args)});
    port.onDisconnect.addListener(()=>{
        isConnected = false;
    })
}
// registerChromePortListeners()

function reconnectIfNeeded() {
    if(blockliveDeleted) {return}
    if(!isConnected) {
        port = chrome.runtime.connect(exId); 
        isConnected = (!!port); 
        if(isConnected){
            registerChromePortListeners();
            liveMessage({meta:"myId",id:blId})
            liveMessage({meta:"joinSession"}) // TODO: maybe do away with sending join message?
            if(readyToRecieveChanges){getAndPlayNewChanges()}
        }
    }
}

///.......... BLOCKLIVE CHECKING ........... //

var blockliveServer


let blId = ''
blVersion = 0
scratchId = location.pathname.split('/')[2] //TODO: use better method?
// scratchId = '644532638'
let pauseEventHandling = false
let projectReplaceInitiated = false
let onceProjectLoaded = []
let vm
let readyToRecieveChanges = false

let reloadAfterRestart=false
async function startBlocklive(creatingNew) {
    blockliveDeleted=false;
    pauseEventHandling = true
    liveMessage({meta:"myId",id:blId})
    injectLoadingOverlay()

    activateBlocklive()
    setTopbarButtonVisibility()
    
    if(creatingNew || store.getState().scratchGui.projectState.loadingState.startsWith('SHOWING')) {
        console.log('project already loaded!')
        if(projectReplaceInitiated) { return }
        await joinExistingBlocklive(blId)
        pauseEventHandling = false;
    } else {
        vm.runtime.on("PROJECT_LOADED", async () => { // todo catch this running after project loads
            if(projectReplaceInitiated) { return }
            await joinExistingBlocklive(blId)
            pauseEventHandling = false;
        })
    }
    if(creatingNew) {
        addToCredits('Get BIocklive for Live Collabs #bl')
    }
}

let blockliveDeleted=false;
async function onTabLoad() {
    // Get usable scratch id
    // await waitFor(()=>{!isNaN(parseFloat(location.pathname.split('/')[2]))})
    // scratchId = location.pathname.split('/')[2]
    waitFor(()=>(!isNaN(parseFloat(location.pathname.split('/')[2])))).then(()=>{scratchId = location.pathname.split('/')[2]})

    // trap vm and store
    let reactInst = Object.values(await getObj('div[class^="stage-wrapper_stage-wrapper_"]')).find((x) => x.child)
    vm = reactInst.child.child.child.stateNode.props.vm;
    store = reactInst.child.child.child.stateNode.context.store
    addButtonInjectors()
    blId = isNaN(parseFloat(location.pathname.split('/')[2])) ? '' : await getBlocklyId(scratchId); //todo: should this use the result of the getBlId function, or a more specific endpoint to authenticating project joining?
    if(!blId) {
        chrome.runtime.sendMessage(exId,{meta:'callback'},(request) => { if(request.meta == 'initBlocklive') { 
            blId = request.blId; 
            startBlocklive(true);}});
    }
    if(!!blId) {
        startBlocklive()
    } else {
    }

}
onTabLoad()

async function joinExistingBlocklive(id) {
    projectReplaceInitiated = true
    console.log('joining blocklive id',id,)
    startBLLoadingAnimation()
    // let inpoint = await getInpoint(id)
    let inpoint = await getJson(id)

    let projectJson = inpoint.json;
    if(inpoint.err) {
        alert('issue joining blocklive id: ' + id + '\n error: ' + inpoint.err);
        finishBLLoadingAnimation();
        pauseEventHandling = false;
        vm.refreshWorkspace();
        removeBlockliveButtons()
        return;
    }
    pauseEventHandling = true
    try {
    // console.log('downloading scratch id',inpoint.scratchId)
    console.log('loading scratch project inpoint',inpoint)
    revertJSON = vm.toJSON()
    await vm.loadProject(projectJson)
        blVersion = inpoint.version
    } catch (e) {
        finishBLLoadingAnimation()
        prompt(`Scratch couldn't load the project JSON we had saved for this project. Clicking OK or EXIT will attempt to load the project from the changelog, which may take a moment. \nError: \n${e} \n\nSend this blocklive id to @ilhp10 on scratch:`,`${blId};`)
        startBLLoadingAnimation()
        // prompt(`Blocklive cannot load project data! The scratch api might be blocked by your network. Clicking OK or EXIT will attempt to load the project from the changelog, which may take a moment. \n\nHere are your ids if you want to report this to @ilhp10:`,`BLOCKLIVE_ID: ${blId}; SCRATCH_REAL_ID: ${scratchId}; INPOINT_ID: ${inpoint.scratchId}`)
    }
    //yo wussup poochdawg

    console.log('syncing new changes, editingTarget: ',vm.editingTarget)
    await getAndPlayNewChanges() // sync changes since scratch version
    finishBLLoadingAnimation()
    liveMessage({meta:"joinSession"}) // join sessionManager session
    readyToRecieveChanges = true
    pauseEventHandling = false;
    // hackyRefreshFlyoutVariables()

    setTimeout(BL_UTILS.refreshFlyout,100) // todo figure way other than timeout

}

function unshareBlocklive() {
    chrome.runtime.sendMessage(exId,{meta:'leaveScratchId',scratchId});
    removeBlockliveButtons();
    blockliveDeleted=true;
    port.disconnect()
}

function removeBlockliveButtons() {
    try{

        // document.querySelector("#app > div > div.gui_menu-bar-position_3U1T0.menu-bar_menu-bar_JcuHF.box_box_2jjDp > div.menu-bar_main-menu_3wjWH > blocklivecontainer")?.remove()
        document.querySelector("#blRevert")?.remove()
        document.querySelector("#noRefreshPanel")?.remove()
        document.querySelector("#blUsersPanel")?.remove()
        document.querySelector("#bl-chat")?.remove()

        blDropdown.style.display = 'none';
        blockliveButton.onclick = blActivateClick
        blId=null;

    } catch(e) {console.error(e)}
}

function getBlocklyId(scratchId) {
    return new Promise((promRes)=>{
    chrome.runtime.sendMessage(exId,{meta:'getBlId',scratchId},promRes)
    })
}
// function getInpoint(blockliveId) {
//     return new Promise((res)=>{chrome.runtime.sendMessage(exId,{meta:'getInpoint',blId:blockliveId},res)})     
// }
function getJson(blockliveId) {
    return new Promise((res)=>{chrome.runtime.sendMessage(exId,{meta:'getJson',blId:blockliveId},res)})     
}
function getChanges(blId,version) {
    return new Promise((res)=>{chrome.runtime.sendMessage(exId,{meta:'getChanges',blId,version},res)})
}
function fetchTitle(blId) {
    return new Promise((res)=>{chrome.runtime.sendMessage(exId,{meta:'getTitle',blId},res)})
}

function setTopbarButtonVisibility() {
    try{
        if(!blId || typeof blCursors == 'undefined' || Object.entries(Object(blCursors)).length==0) {document.getElementById('blUsersPanel').style.visibility = 'hidden'}
        else {document.getElementById('blUsersPanel').style.visibility = 'visible'}
    } catch(e) {console.error(e)}
    try{
        if(!blId) {document.getElementById('blChatButton').style.visibility = 'hidden'}
        else {document.getElementById('blChatButton').style.visibility = 'visible'}
    } catch(e) {console.error(e)}
}

let getAndPlayNewChanges

async function activateBlocklive() {

    addChat() 

    playChanges = async (changes)=>{
        console.log('syncing new changes:',changes)
        if(changes.forceReload) {forceReload()}

        pauseEventHandling = true
        for (let i = 0; i < changes.length; i++) {
            await blockliveListener(changes[i])
        }
        if(changes.currentVersion){blVersion = changes.currentVersion}
        pauseEventHandling = false

        vm.emitWorkspaceUpdate()
        vm.emitTargetsUpdate()
    }

    // set scope exposed functions    
    getAndPlayNewChanges = async ()=>{

        console.log('syncing since version: ' +  blVersion) 
        fetchTitle(blId).then(title=>setTitle(title)) // set title

        // sync all other project changes
        changes = await getChanges(blId,blVersion)
        if(typeof BL_UTILS != 'undefined' && BL_UTILS.isDragging()) {
            console.log('queing it for later')
            playAfterDragStop.push({meta:'resyncCached',changes})
        } else {
            await playChanges(changes)
        }    
    }

    function forceReload() {
        window.onbeforeunload=null;
        location.reload()
    }

///.......... CONNECT TO CHROME PORT ..........//

function connectFirstTime() {
    reconnectIfNeeded()
    // request for blockliveId
    // liveMessage({meta:"hiimhungry"})
}
connectFirstTime()

setInterval(reconnectIfNeeded,1000)

/// other things

    blockliveListener = async (msg) => {
        if(blockliveDeleted) {return}
        if(typeof BL_UTILS != 'undefined' && BL_UTILS.isDragging()) {
            // dong add to list if its a move event on the current moving block
            if(msg.meta == 'vm.blockListen' && msg.type == 'move' && msg.event.blockId == BL_UTILS.getDraggingId()) {return}
            else { playAfterDragStop.push(msg) }
            return;
        }
    
        // console.log('recieved message',msg)
        if(!!msg.version){blVersion = msg.version-1} // TODO: possibly disable this
        try{
        if(msg.meta == 'resyncCached') {
            // remember to await shit
            await playChanges(msg.changes)
        } else if (msg.meta=="sprite.proxy") {
            blVersion++
            await proxyActions[msg.data.name](...(['linguini'].concat(msg.data).concat(msg.data.args)))
        } else if (msg.meta =="vm.blockListen") {
            blVersion++
            onBlockRecieve(msg)
        } else if (msg.meta == "messageList") {
            for (let i = 0; i < msg.messages.length; i++) {
                await blockliveListener(msg.messages[i])
            }
        } else if (msg.meta == "vm.shareBlocks") {
            blVersion++
            doShareBlocksMessage(msg)        
        } else if (msg.meta == 'vm.replaceBlocks') {
            if(!nameToTarget(msg.target)?.blocks) {
                // console.log('saving for later')
                addNewTargetEvent(msg.target,msg);
            }
            else {
                // console.log('doing')
                blVersion++
                replaceBlockly(msg)
            }
        } else if(msg.meta == 'vm.updateBitmap') { // TODO: Do this better-- pass in changes from bg script
            blVersion++;
            await updateBitmap(msg)
        } else if(msg.meta == 'vm.updateSvg') { // TODO: Do this better-- pass in changes from bg script
            blVersion++;
            await updateSvg(msg)
        } else if(msg.meta=='yourVersion') {
            console.log('version ponged: ' + msg.version)
            blVersion = msg.version
        } else if(msg.meta == 'setTitle') {
            setTitle(msg.title)
        } else if(msg.meta == 'resync') { // TODO: Do this better-- pass in changes from bg script
            if(readyToRecieveChanges){getAndPlayNewChanges()}
        } else if(msg.meta == 'version++') {
            blVersion++;
        } else if(msg.meta == 'chat') {
            addMessage(msg.msg,true)
        }
        } catch (e) {console.error(e)}
    }


///.......... TRAPS ..........//
// Thanks garbomuffin and scratchaddons for guidance

// set helpful function to download projet and return the promise
async function downloadProjectIdPromise (id) {
    const storage = this.runtime.storage;
    if (!storage) {
        log.error('No storage module present; cannot load project: ', id);
        return;
    }
    const vm = this;
    const promise = storage.load(storage.AssetType.Project, id);
    projectAsset = await promise
    return vm.loadProject(projectAsset.data);
}
vm.downloadProjectIdPromise = downloadProjectIdPromise.bind(vm)

// Trap ScratchBlocks -- adapted from https://github.com/ScratchAddons/ScratchAddons/blob/4248dc327a9f3360c77b94a89e396903218a2fc2/addon-api/content-script/Trap.js

// let reactElem = (await getObj(()=>document.querySelector('[class^="gui_blocks-wrapper"]')))

listenForObj('[class^="gui_blocks-wrapper"]',(reactElem)=>{

// let reactElem = (await getObj('[class^="gui_blocks-wrapper"]'))
let reactInst;
for(let e of Object.entries(reactElem)) {
    if(e[0].startsWith('__reactInternalInstance')) {
        reactInst = e[1];
        break;
    }
}

let childable = reactInst;
/* eslint-disable no-empty */
while (((childable = childable.child), !childable || !childable.stateNode || !childable.stateNode.ScratchBlocks)) {}

ScratchBlocks = childable.stateNode.ScratchBlocks;
getWorkspace().removeChangeListener(blockListener)
getWorkspace().addChangeListener(blockListener)
})

// Trap Paint
function getPaper() {
    let paperContainer = document.querySelector("[class^='paint-editor_canvas-container']")
    if(!paperContainer) return null;
    let reactInst;
    for(let e of Object.entries(paperContainer)) {
        if(e[0].startsWith('__reactInternalInstance')) {
            reactInst = e[1];
            break;
        }
    }
    return reactInst?.child?.child?.child?.stateNode
}

///.......... ALL THE HACKY THINGS ..........//



function isWorkspaceAccessable() {
    return !!document.querySelector('.blocklyWorkspace')
}

function getWorkspace() {
    let retVal = Blockly.getMainWorkspace()
    if(typeof ScratchBlocks == 'undefined') {return retVal}
    Object.entries(ScratchBlocks.Workspace.WorkspaceDB_).forEach(wkv=>{
        if(!wkv[1].isFlyout && wkv[1].deleteAreaToolbox_) {retVal = wkv[1]}
    })
    return retVal;
}
function getFlyout() {
    if(typeof ScratchBlocks == 'undefined') {return null}
    Object.entries(ScratchBlocks.Workspace.WorkspaceDB_).forEach(wkv=>{
        if(wkv[1].isFlyout /*&& wkv[1].deleteAreaToolbox_*/) {retVal = wkv[1]}
    })
    return retVal;
}
function getWorkspaceId() {
    return getWorkspace()?.id
}

function getDraggingId() {
    return Blockly.getMainWorkspace().getBlockDragSurface().getCurrentBlock()?.getAttribute('data-id')
}
function isDragging() {
    return Blockly.getMainWorkspace()?.isDragging()
}

// STAGE IDENTIFIER. DO NOT SET SPRITE NAME TO THIS UNLESS YOU WANT TO PURPOSEFULLY BREAK LINKAGE!!!!
let stageName = 'jHHVSbKjDsRhSWhIlYtd...___+_0)0+-amongus'
function targetToName(target) {
    return target?.isStage ? stageName : target?.sprite.name
}
function nameToTarget(name) {
    return name == stageName ? vm.runtime.getTargetForStage() : vm.runtime.getSpriteTargetByName(name)
}

// Credit to GarboMuffin and apple502j https://github.com/ScratchAddons/ScratchAddons/blob/399e2e51ca43e9299c8d07ff315b91966c7c1a5e/addons/onion-skinning/userscript.js#L428
const getSelectedCostumeIndex = () => {
    const item = document.querySelector("[class*='selector_list-item'][class*='sprite-selector-item_is-selected']");
    if (!item) return -1;
    const numberEl = item.querySelector("[class*='sprite-selector-item_number']");
    if (!numberEl) return -1;
    return +numberEl.textContent - 1;
};

function refreshFlyout() {
    vm.emitWorkspaceUpdate()
    // update flyout for new variables and blocks
    if(!BL_UTILS.isWorkspaceAccessable()){return}
    BL_UTILS.getWorkspace().getToolbox().refreshSelection()
    setTimeout(()=>{
        if(BL_UTILS.isWorkspaceAccessable()) {
            BL_UTILS.getWorkspace().toolboxRefreshEnabled_ = true
        }
    },130);
}
BL_UTILS = {
    isWorkspaceAccessable,
    getWorkspace,
    getFlyout,
    getWorkspaceId,
    getDraggingId, isDragging,
    targetToName,
    nameToTarget,
    getSelectedCostumeIndex,
    refreshFlyout,
}

BL_UTILS.stageName = stageName

// send to api when project saved and name change
let lastProjectState = store.getState().scratchGui.projectState.loadingState
let lastTitle = store.getState().preview.projectInfo.title
let settingTitle = null
let titleYetUnset = true;
setTimeout(()=>{titleYetUnset=false},1000 * 2)

store.subscribe(function() {
    // HANDLE PROJECT SAVE
    let state = store.getState().scratchGui.projectState.loadingState
    if(lastProjectState != state) { // If state changed
        lastProjectState = store.getState().scratchGui.projectState.loadingState
        console.log('state '+state)
        if(state.endsWith('UPDATING')) {
            console.log('🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢')
            chrome.runtime.sendMessage(exId,{meta:'projectSavedJSON',blId,json:vm.toJSON(),version:blVersion,})
            // chrome.runtime.sendMessage(exId,{meta:'projectSaved',blId,scratchId,version:blVersion})
        }
        try{
        if(state == 'SHOWING_WITH_ID') {
            finishedSavingCB.forEach((func)=>{func()})
        }}catch(e){console.error(e)}
    }

    // HANDLE TITLE CHANGE
    let title = store.getState().preview.projectInfo.title
    if(title != lastTitle && !titleYetUnset) {
        console.log(`title changed from ${lastTitle} to ${title}`)
        lastTitle = title
        if(title != settingTitle) {
            liveMessage({meta:'setTitle',blId,title})
        }
    }
})


function setTitle(title) {
    settingTitle = title
    let elem = document.querySelector("#frc-title-1088") //Todo: query id
    if(elem) {
        Object.entries(elem).find(en=>en[0].startsWith('__reactEventHandlers$'))[1].onBlur({currentTarget:{value:title}})
    } else {
        store.dispatch({
            type: 'projectTitle/SET_PROJECT_TITLE',
            title
        });
    }
}



function replaceBlockly(msg) {
    // replace a target's block data (used for syncing id's on sprite duplicate)
    let target = nameToTarget(msg.target);
    let blocks = target.blocks
    Object.keys(blocks._blocks).forEach(v=>{blocks.deleteBlock(v)})
    // console.log(msg.blocks)
    Object.values(msg.blocks).forEach(block=>{blocks.createBlock(block)})
    if(targetToName(vm.editingTarget) == targetToName(target)) {vm.emitWorkspaceUpdate()}
}


proxyActions = {}
//action: vm action function
//name: name to put in recort
//mutator: args generator from recieved data object (has args field)
//then: callback for those replaying action

// mutator takes data object {name, args, extrargs} and returns args list

let prevTarg = null
function editingProxy(action,name,before,after,extrargs,mutator) {
    return proxy(action,name,
        (a)=>({target:targetToName(vm.editingTarget),...(extrargs ? extrargs(a) : null)}),mutator,
        (data)=>{
            if(!!before){before(data)}
            prevTarg = vm.editingTarget
            vm.editingTarget = nameToTarget(data.extrargs.target)
            vm.runtime._editingTarget = vm.editingTarget
        },
        (_a,_b,data)=>{
            if(!prevTarg) {'PREVTARG IS UNDEFINED'}
            if(!!prevTarg && !!vm.runtime.getTargetById(prevTarg.id)) {
            vm.editingTarget = prevTarg;
            vm.runtime._editingTarget = prevTarg
            }
            vm.emitTargetsUpdate()
            if(!!after){after(_a,_b,data)}
        })
}

function proxy(action,name,extrargs,mutator,before,then,dontSend,dontDo,senderThen) {
    return anyproxy(vm,action,name,extrargs,mutator,before,then,dontSend,dontDo,senderThen)
}
function anyproxy(bindTo,action,name,extrargs,mutator,before,then,dontSend,dontDo,senderThen) {
    let proxiedFunction =function(...args) {
        if(args[0]=='linguini') {
// if linguini, ...args are ['linguini', data, data.args]
            args.splice(0,1)
            let data = args.splice(0,1)[0]
            // console.log('data:')
            // console.log(data)
            if(mutator){args = mutator(data)}
            // else {args = data.args}

            let prevTarget = vm.editingTarget
            if(!!before) {before(data)}
            if(dontDo?.(data)) {return}
            proxiedArgs = args
            let retVal
            try{retVal = action.bind(bindTo)(...args)}catch(e){console.error('error on proxy run',e)}
            if(then) {
                if(!!retVal?.then) {
                    // if returns a promise
                        retVal.then((res)=>{then(prevTarget,vm.editingTarget,data,res)})
                    } else {
                    // if is normal resolved function
                        then(prevTarget,vm.editingTarget,data,retVal)
                    }
            }
            return retVal
        } else {
            if(pauseEventHandling) {
                return action.bind(bindTo)(...args)
            } else {
            // console.log('intrecepted:')
            // console.log(...args)
            let extrargsObj = null;
            if(!!extrargs) {extrargsObj=extrargs(args)}
            proxiedArgs = args

            let retVal = action.bind(bindTo)(...args)
            if(!dontSend?.(...args)) { liveMessage({meta:"sprite.proxy",data:{name,args,extrargs:extrargsObj}}) }
            if(senderThen) {
                if(!!retVal?.then) {
                    // if returns a promise
                        retVal.then(senderThen)
                    } else {
                    // if is normal resolved function
                    senderThen()
                    }
            }
            return retVal
        }
        }
    }
    proxyActions[name] = proxiedFunction;
    return proxiedFunction;
}

function asyncEditingProxy(action,name,before,after,extrargs,mutator) {
    return asyncAnyproxy(vm,action,name,
        (a)=>({target:targetToName(vm.editingTarget),...(extrargs ? extrargs(a) : null)}),mutator,
        (data)=>{
            if(!!before){before(data)}
            prevTarg = vm.editingTarget
            vm.editingTarget = nameToTarget(data.extrargs.target)
            vm.runtime._editingTarget = vm.editingTarget
        },
        (_a,_b,data)=>{
            if(!prevTarg) {'PREVTARG IS UNDEFINED'}
            if(!!prevTarg && !!vm.runtime.getTargetById(prevTarg.id)) {
            vm.editingTarget = prevTarg;
            vm.runtime._editingTarget = prevTarg
            }
            vm.emitTargetsUpdate()
            if(!!after){after(_a,_b,data)}
        })
}

function asyncAnyproxy(bindTo,action,name,extrargs,mutator,before,then,dontSend,dontDo,senderThen) {
    let proxiedFunction =async function(...args) {
        if(args[0]=='linguini') {
// if linguini, ...args are ['linguini', data, data.args]
            args.splice(0,1)
            let data = args.splice(0,1)[0]
            // console.log('data:')
            // console.log(data)
            if(mutator){args = await mutator(data)}
            // else {args = data.args}

            let prevTarget = vm.editingTarget
            if(!!before) {before(data)}
            if(dontDo?.(data)) {return}
            proxiedArgs = args
            let retVal
            try{retVal = action.bind(bindTo)(...args)}catch(e){console.error('error on proxy run',e)}
            if(then) {
                if(!!retVal?.then) {
                    // if returns a promise
                        retVal.then((res)=>{then(prevTarget,vm.editingTarget,data,res)})
                    } else {
                    // if is normal resolved function
                        then(prevTarget,vm.editingTarget,data,retVal)
                    }
            }
            return retVal
        } else {
            if(pauseEventHandling) {
                return action.bind(bindTo)(...args)
            } else {
            // console.log('intrecepted:')
            // console.log(...args)
            let extrargsObj = null;
            if(!!extrargs) {extrargsObj=extrargs(args)}
            proxiedArgs = args

            let retVal = action.bind(bindTo)(...args)
            if(!dontSend?.(...args)) { liveMessage({meta:"sprite.proxy",data:{name,args,extrargs:extrargsObj}}) }
            if(senderThen) {
                if(!!retVal?.then) {
                    // if returns a promise
                        retVal.then(senderThen)
                    } else {
                    // if is normal resolved function
                    senderThen()
                    }
            }
            return retVal
        }
        }
    }
    proxyActions[name] = proxiedFunction;
    return proxiedFunction;
}


// todo catch shadow create
function isBadToSend(event, target) {
    switch(event.type) {
        // filter out shadow events that shouldnt be proxied
        case 'create': if(event.xml.nodeName == "SHADOW") {return true}
        case 'delete': if(event.oldXml?.nodeName == "SHADOW") {return true}
        case 'move' : {
            let block = target.blocks.getBlock(event.blockId)
            if(block?.shadow) {return true}

            // edge case: c1 move unlinked var block into parent block. c2 blocklive mistakenly moves a linked block into that place. c2 moves linked block out of the parent block and does not move out of c1
            // dont send if moves a varible to same position
            // if(!!block && (block.fields.VARIABLE || block.fields.LIST)) {
            //     if(!!event.oldCoordinate && !!event.newCoordinate && (
            //         Math.round(event.oldCoordinate.x) == Math.round(event.newCoordinate.x) &&
            //         Math.round(event.oldCoordinate.y) == Math.round(event.newCoordinate.y)
            //     )) {return true}
            // }
        }
    }
    return false
}

// Todo catch bad deletes (var, comment)
// get current drag id
// ScratchBlocks.getMainWorkspace().getBlockDragSurface().getCurrentBlock()?.getAttribute('data-id')

function isBadToRun(event, target) {
    switch (event.type) {
        // dont run if block already exists
        case 'create': return !!target.blocks.getBlock(event.blockId);
        case 'delete': return !target.blocks.getBlock(event.blockId);
        // dont run if comment already exists
        case 'comment_create': return event.commentId in target.comments;
        case 'move': {
            // dont run if block doesnt exist
            if(!target.blocks.getBlock(event.blockId)) return true;
            // dont run if block is already close enough to position (rounded to 1's place)
            // ...and make sure that the event specifies x and y before checking!
            if(!!event.newCoordinate?.x && !!event.newCoordinate?.y) {
                let localBlock = target.blocks.getBlock(event.blockId)
                if(Math.round(localBlock.x)== Math.round(event.newCoordinate.x) &&
                Math.round(localBlock.y) == Math.round(event.newCoordinate.y))
                { return true; }
            }
            // dont run if newParentId is the same (assuming exists)
            if(!!event.newParentId) {
                let localBlock = target.blocks.getBlock(event.blockId)
                if(localBlock.parent == event.newParentId){return true;}
            }
        }
    }
    return false;
}
// Interface with ScratchBlocks object
function isBadToRunBlockly(event,workspace) {
    switch (event.type) {
        // dont run if block already exists
        case 'create': return !!workspace.getBlockById(event.blockId)
    }
    
}

function getStringEventRep(e) {
    let rep = e.type + e.blockId + e.commentId + e.varId
    switch(e.type) {
        case 'move':
            rep += parseInt(e.newCoordinate?.x) + ''
            + parseInt(e.newCoordinate?.y) + ''
            + e.newParentId + ''
            break;
        case 'change':
            rep += e.name + e.newValue + e.element
            break;
        case 'var_create':
            rep += e.varName + e.isCloud + e.isLocal
            break;
        case 'var_delete':
            rep += e.varName + e.isCloud + e.isLocal
            break;
        case 'var_rename':
            rep += e.newName
            break;
        case 'comment_change':
            rep += JSON.stringify(e.newContents_,(k,v)=>(v?.toFixed ? Number(v.toFixed(0)) : v))
            break;
        case 'comment_move':
            rep += Math.round(e.newCoordinate_?.x)
            + Math.round(e.newCoordinate_?.y)
            break;
    }
    return rep.replaceAll("undefined","null")
}

oldBlockListener = vm.blockListener
blockliveEvents = {}
createEventMap = {}
toBeMoved = {}
// listen to local blockly events
function blockListener(e) {
    // console.log('is event handling & workspace updating paused?: ' + pauseEventHandling)
    if(pauseEventHandling) {return}
    console.log('just intrecepted',e)
    if(e.type == 'ui'){uiii = e}
    if(e.type == 'create'){createe = e}
    if(e.type == 'delete'){deletee = e}
    if(e.type == 'change'){changee = e}
    if(e.type == 'move'){movee = e}
    if(e.type == 'comment_change'){comee = e}
    // filter ui events and blocklive
    let stringRep = getStringEventRep(e)
    if(stringRep in blockliveEvents) {delete blockliveEvents[stringRep]}
    else if(
        !e.isBlocklive && 
        ["endDrag",'ui','dragOutside'].indexOf(e.type) == -1 &&
        !isBadToSend(e,vm.editingTarget) &&
        e.element != 'stackclick'
    ) {
        let extrargs = {}
        
        // send variable locator info
        if(e.type == 'move') {
            let block = vm.editingTarget.blocks.getBlock(e.blockId)
            if(!!block && (block.fields.VARIABLE || block.fields.LIST)) {
                extrargs.blockVarId = block.fields.VARIABLE ? block.fields.VARIABLE.id : block.fields.LIST.id
            }
        } else if(e.type == 'change' && (e.name == "VARIABLE" || e.name == "LIST")){
            let block = vm.editingTarget.blocks.getBlock(e.blockId)
            if(!!block && (
                block.opcode == "data_variable" || block.opcode == "data_listcontents"
            )) {
                extrargs.blockVarId = e.oldValue
                extrargs.blockVarParent = block.parent
                extrargs.blockVarPos = {x:block.x,y:block.y}
                extrargs.blockVarInput = Object.values(new Object(vm.editingTarget.blocks.getBlock(block.parent)?.inputs))?.find(input=>(input.block==e.blockId))?.name
            }
        } else if(e.type == 'delete' && (
            e.oldXml?.firstElementChild?.getAttribute('name') == 'VARIABLE' ||
            e.oldXml?.firstElementChild?.getAttribute('name') == 'LIST'
        )) {
            let block = !!vm.editingTarget.blocks._blocks[e.blockId] ? vm.editingTarget.blocks._blocks[e.blockId] : lastDeletedBlock
            extrargs.blockVarId = block.fields.VARIABLE ? block.fields.VARIABLE.id : block.fields.LIST.id
            extrargs.blockVarParent = block.parent
            extrargs.blockVarPos = {x:block.x,y:block.y}
            extrargs.blockVarInput = Object.values(new Object(vm.editingTarget.blocks.getBlock(block.parent)?.inputs))?.find(input=>(input.block==e.blockId))?.name
        }

        // send field locator info
        if(e.element == 'field') {
            if(vm.editingTarget.blocks.getBlock(e.blockId).shadow) {
            let fieldInputId = e.blockId
            let fieldInput = vm.editingTarget.blocks.getBlock(fieldInputId)
            let parentId = fieldInput.parent
            if(!!parentId) {
                let parentBlock = vm.editingTarget.blocks.getBlock(parentId)
                let inputTag = Object.values(new Object(parentBlock.inputs)).find(input=>input.shadow==fieldInputId).name

                extrargs.parentId = parentId
                extrargs.fieldTag = inputTag
            }
            }
        }

        // send broadcast name (in case of auto broadcast delete on recieving client)
        if(e.type == 'change' && e.name == "BROADCAST_OPTION") {
            extrargs.broadcastName = vm.runtime.getTargetForStage().variables[e.newValue]?.name
            extrargs.broadcastId = vm.runtime.getTargetForStage().variables[e.newValue]?.id
        }

        // send block xml-related things
        if(!!e.xml) {
            extrargs.xml = {outerHTML:e.xml.outerHTML}
            extrargs.isCBCreateOrDelete = e.xml?.getAttribute('type') == 'procedures_definition'
        }
        if(!!e.oldXml) {
            extrargs.isCBCreateOrDelete = extrargs.isCBCreateOrDelete || e.oldXml?.getAttribute('type') == 'procedures_definition'
        }

        // console.log("sending",e,extrargs,'target',targetToName(vm.editingTarget))

        let message = {meta:"vm.blockListen",type:e.type,extrargs,event:e,json:e.toJson(),target:targetToName(vm.editingTarget),}
        
        // intercept and save create events to send later
        if(e.type == "create") {
            createEventMap[e.blockId] = message
        // } else if (e.type == 'comment_create') { //TODO: maybe add back
        //     createEventMap[e.commentId] = message
        // intercept auto generated move event
        } else if ((e.type == 'move') && e.blockId in toBeMoved){
            let moveEvents = toBeMoved[e.blockId]
            // console.log("move events",moveEvents)
            delete toBeMoved[e.blockId]
            moveEvents.forEach(moveMessage=>onBlockRecieve(moveMessage))
        }
        else {
            // send held off create events
            if(e.blockId in createEventMap) {
                // erase from face of existance
                if(e.type == 'delete') {
                    message = null
                } else { 
                    liveMessage(createEventMap[e.blockId])
                    // setTimeout(()=>{liveMessage(createEventMap[e.blockId])},5000 )
                }
                delete createEventMap[e.blockId]
            }
            if(e.commentId in createEventMap) {
                if(e.type == 'comment_delete') {
                    message = null
                } else { 
                    liveMessage(createEventMap[e.commentId]) 
                    // setTimeout(()=>{liveMessage(createEventMap[e.commentId]) },5000)
                }
                delete createEventMap[e.commentId]
            }
            if(!!message){
                liveMessage(message)
                console.log('sending',message,getStringEventRep(message.event)) // toremove

                // setTimeout(()=>{liveMessage(message)},5000)
            }
        }
    }
    // ___DONT___ Forward (do) event
    // oldBlockListener(e)
}

/// Todo: testing on whether or not to actually execute actions
// Todo: catch stage not being sprite
// Remove thing from undo list

function getDistance(p1,p2) {
    return Math.sqrt(Math.pow(p2.x-p1.x,2) + Math.pow(p2.y-p1.y,2))
}

function onBlockRecieve(d) {

    // for comment parsing cause they did the toJson wrong apparently
    if(d.type == 'comment_change') {
        d.json.newValue = d.json.newContents
    }

    let oldEditingTarget = vm.editingTarget
    // set editing target
    vm.editingTarget = nameToTarget(d.target)
    vm.runtime._editingTarget = vm.editingTarget

    // pause workspace updating
    pauseWorkspaceUpdating()

    try{
    let vEvent = d.event
    let bEvent = {}
    if(isWorkspaceAccessable()) {
        bEvent = ScratchBlocks.Events.fromJson(d.json,getWorkspace())
    }
    //set blockly event tag
    bEvent.isBlocklive = true

    //........... Modify event ...........//

    // set vm type
    vEvent.type = d.type

    // find true variable block if needed
    if(d.extrargs.blockVarId && !(d.event.blockId in toBeMoved) && !vm.editingTarget.blocks.getBlock(d.event.blockId)) {
        if(d.event.oldParentId || d.extrargs.blockVarParent) {
            let oldParentId = d.extrargs.blockVarParent ? d.extrargs.blockVarParent : d.event.oldParentId
            let realId = vm.editingTarget.blocks.getBlock(oldParentId).inputs[d.extrargs.blockVarInput ? d.extrargs.blockVarInput : d.event.oldInputName].block
            vEvent.blockId = realId;
            bEvent.blockId = realId;
            if(d.type == 'delete') {
                bEvent.ids = [realId];
                vEvent.ids = [realId];
            }
        } else if(d.event.oldCoordinate || d.extrargs.blockVarPos) {
            let oldCoordinate = d.extrargs.blockVarPos ? d.extrargs.blockVarPos : d.event.oldCoordinate
            let varBlocks = vm.editingTarget.blocks._scripts.filter((blockId)=>{
                let block = vm.editingTarget.blocks.getBlock(blockId)
                return (
                    block?.fields?.VARIABLE?.id == d.extrargs.blockVarId ||
                    block?.fields?.LIST?.id == d.extrargs.blockVarId
                )
            })
            let closestBlock
            let closestDistance = -1
            varBlocks.forEach(blockId=>{
                let block = vm.editingTarget.blocks.getBlock(blockId)
                if(!block.parent) {
                    let distance = getDistance({x:block.x,y:block.y},oldCoordinate)
                    if(!closestBlock || distance < closestDistance) {
                        closestBlock = block
                        closestDistance = distance
                    }
                }
            })
            if(!closestBlock) {/*console.log('bruh')*/}
            else {
                vEvent.blockId = closestBlock.id;
                bEvent.blockId = closestBlock.id;
                if(d.type == 'delete') {
                    bEvent.ids = [closestBlock.id];
                    vEvent.ids = [closestBlock.id];
                }
            }
        }
    }

    //find true field
    let queueUpdate = false;
    if(!!d.extrargs.fieldTag) {
        let realId = vm.editingTarget.blocks.getBlock(d.extrargs.parentId).inputs[d.extrargs.fieldTag].shadow
        // queueUpdate = vm.editingTarget.blocks.getBlock(realId)?.opcode == 'sensing_of_object_menu' // workspace update if updates mid-
        vEvent.blockId = realId;
        bEvent.blockId = realId;
    }

    // create broadcast if needed
    if(!!d.extrargs.broadcastName && !vm.runtime.getTargetForStage().variables[d.json.newValue]) {
        let createVmEvent = {isCloud: false, isLocal: false, type: "var_create", varId: d.extrargs.broadcastId, varName: d.extrargs.broadcastName, varType: "broadcast_msg"}
        console.log('remaking broadcast',createVmEvent)
        vm.blockListener(createVmEvent)

        if(isWorkspaceAccessable()) {
            let createBlEvent = ScratchBlocks.Events.fromJson(createVmEvent,getWorkspace())
            blockliveEvents[getStringEventRep(createBlEvent)] = true
            createBlEvent.run(true)
        }
    }

    //xml
    if(!!d.extrargs.xml) {
        vEvent.xml = d.extrargs.xml
    }

    // add comment create xy
    if(d.type == "comment_create") {
        bEvent.xy = d.event.xy
    }

    if(
        (
            (targetToName(oldEditingTarget) == d.target && !pauseEventHandling) || // if in same editing target that event is for
            (['var_create','var_delete'].indexOf(d.type) != -1 && !d.json.isLocal) // or if event is a global variable create or delete
        )
        && isWorkspaceAccessable() // and no matter what make sure that workspace is accessable
    ){
        // save speedy move and delete events for later
        if((bEvent.type == 'move' || bEvent.type == 'delete') && bEvent.blockId in toBeMoved) {toBeMoved[bEvent.blockId].push(d)}
        else{
        //inject directly into blockly
        if(!isBadToRunBlockly(bEvent,getWorkspace()) && !isBadToRun(bEvent,vm.editingTarget)) {
            // record newly made block so that we can intercept it's blockly auto-generated move event later
            // ...dont record it for newly created custom block definitions
            if(bEvent.type == 'create' && !d.extrargs.isCBCreateOrDelete){toBeMoved[bEvent.blockId] = []} 
            // record played blocklive event
            blockliveEvents[getStringEventRep(bEvent)] = true
            // run event

            // try to add transition element stuff
            // if(false ) {
            if(bEvent.type == 'move') {
                let blockElement = getWorkspace()?.getBlockById(bEvent.blockId)?.getSvgRoot()
                console.log(blockElement)
                if(blockElement) {
                    blockElement.style.transition='transform 0.5s';
                }
            }
        // }
    
            // blockElement?.style.transitionProperty='transform';

            bEvent.run(true)
            // blockElement?.style.transition='transform 0.5s';

            lastEventRun = bEvent 

            // for custom blocks, update toolbox
            if(bEvent.element == "mutation" || d.extrargs.isCBCreateOrDelete) {
                getWorkspace().getToolbox().refreshSelection()
            }

            // highlight blocks
            if(['create','move','change'].indexOf(bEvent.type)) {
                let blockId = bEvent.blockId
                try{
                    outlineBlock(blockId, d.user)
                } catch (e) {console.error(e)}
            }
            // 'comment_create','comment_change','comment_move'

        }
    }
    } else {
        if(!isBadToRun(vEvent,vm.editingTarget)) {
            vm.editingTarget.blocks.blocklyListen(vEvent)
        }
    }
    }catch(e) {console.error('error on block event execution',e)}
    //reset editing target
    if(!oldEditingTarget) {console.log('old editing target is undefined!')}
    if(!!oldEditingTarget && !!vm.runtime.getTargetById(oldEditingTarget.id)) {
    vm.editingTarget = oldEditingTarget
    vm.runtime._editingTarget = oldEditingTarget
    }
    continueWorkspaceUpdating()
}

let oldTargUp = vm.emitTargetsUpdate.bind(vm)
// window.BL_UTILS.unsafeTargetsUpdate=oldTargUp;
window.etuListeners = []
vm.emitTargetsUpdate = function(...args) {
    etuListeners.forEach(e=>{try{e?.()}catch(e){console.error(e)}})
    etuListeners = []
    if(pauseEventHandling) {return}
    else {oldTargUp(...args)}

    // move my bubble
//    moveMyBubble()
}

let oldEWU = (vm.emitWorkspaceUpdate).bind(vm)

bl_workspaceUpdatingPaused = false
bl_workspaceUpdateRequested = false
function pauseWorkspaceUpdating() {
    bl_workspaceUpdatingPaused = true  
}
function continueWorkspaceUpdating() {
    bl_workspaceUpdatingPaused = false
    if(bl_workspaceUpdateRequested) {vm.emitWorkspaceUpdate()}
    bl_workspaceUpdateRequested = false
}

vm.emitWorkspaceUpdate = function() {
    if(pauseEventHandling) {console.log('workspace update voided'); return;}
    if(bl_workspaceUpdatingPaused) {bl_workspaceUpdateRequested = true; console.log('workspace update saved'); return;}
    if(!isWorkspaceAccessable()) {return;}

    console.log("WORKSPACE UPDATING")
    // add deletes for comments
    getWorkspace()?.getTopComments().forEach(comment=>{
        blockliveEvents[getStringEventRep({type:'comment_delete',commentId:comment.id})] = true
    })
    // add creates for comments in new workspace
    Object.keys(vm.editingTarget.comments).forEach(commentId=>{
        blockliveEvents[getStringEventRep({type:'comment_create',commentId})] = true
    })
    // add deletes for top blocks in current workspace
    getWorkspace()?.topBlocks_.forEach(block=>{
        blockliveEvents[getStringEventRep({type:'delete',blockId:block.id})] = true
    })
    // add creates for all blocks in new workspace
    Object.keys(vm.editingTarget.blocks._blocks).forEach(blockId=>{
        blockliveEvents[getStringEventRep({type:'create',blockId})] = true;
        let block = vm.editingTarget.blocks._blocks[blockId]
        if(!block.parent) {
            let moveRep = getStringEventRep({
                type:'move',
                blockId,
                newCoordinate:{x:block.x,y:block.y},
                newParentId:block.parent
            })
            console.log(moveRep)
            blockliveEvents[moveRep] = true
        }
    })
    // add var creates and deletes
    Object.entries(vm.editingTarget.variables).forEach(varr=>{
        blockliveEvents[getStringEventRep({type:'var_delete',varId:varr[0],isCloud:varr[1].isCloud,varName:varr[1].name,isLocal:false})] = true
        blockliveEvents[getStringEventRep({type:'var_create',varId:varr[0],isCloud:varr[1].isCloud,varName:varr[1].name,isLocal:true})] = true
    })
    // add global (local:false) var creates
    Object.entries(vm.runtime.getTargetForStage().variables).forEach(varr=>{
        // blockliveEvents[getStringEventRep({type:'var_delete',varId:varr[0],isCloud:varr[1].isCloud,varName:varr[1].name,isLocal:false})] = true
        blockliveEvents[getStringEventRep({type:'var_create',varId:varr[0],isCloud:varr[1].isCloud,varName:varr[1].name,isLocal:false})] = true
    })

    oldEWU()

    // set animation
    // Blockly.getMainWorkspace().getAllBlocks().forEach(block=>{block.getSvgRoot().style.transition='transform 0.5s';})
}

//////////////////////////////// load-costume copied (modified to remove dependencies) from https://github.com/LLK/scratch-vm/blob/develop/src/import/load-costume.js ////////////////////////////////// 

let BL_load_costume = {};
{
const canvasPool = (function () {
    /**
     * A pool of canvas objects that can be reused to reduce memory
     * allocations. And time spent in those allocations and the later garbage
     * collection.
     */
    class CanvasPool {
        constructor () {
            this.pool = [];
            this.clearSoon = null;
        }

        /**
         * After a short wait period clear the pool to let the VM collect
         * garbage.
         */
        clear () {
            if (!this.clearSoon) {
                this.clearSoon = new Promise(resolve => setTimeout(resolve, 1000))
                    .then(() => {
                        this.pool.length = 0;
                        this.clearSoon = null;
                    });
            }
        }

        /**
         * Return a canvas. Create the canvas if the pool is empty.
         * @returns {HTMLCanvasElement} A canvas element.
         */
        create () {
            return this.pool.pop() || document.createElement('canvas');
        }

        /**
         * Release the canvas to be reused.
         * @param {HTMLCanvasElement} canvas A canvas element.
         */
        release (canvas) {
            this.clear();
            this.pool.push(canvas);
        }
    }

    return new CanvasPool();
}());

/**
 * Return a promise to fetch a bitmap from storage and return it as a canvas
 * If the costume has bitmapResolution 1, it will be converted to bitmapResolution 2 here (the standard for Scratch 3)
 * If the costume has a text layer asset, which is a text part from Scratch 1.4, then this function
 * will merge the two image assets. See the issue LLK/scratch-vm#672 for more information.
 * @param {!object} costume - the Scratch costume object.
 * @param {!Runtime} runtime - Scratch runtime, used to access the v2BitmapAdapter
 * @param {?object} rotationCenter - optionally passed in coordinates for the center of rotation for the image. If
 *     none is given, the rotation center of the costume will be set to the middle of the costume later on.
 * @property {number} costume.bitmapResolution - the resolution scale for a bitmap costume.
 * @returns {?Promise} - a promise which will resolve to an object {canvas, rotationCenter, assetMatchesBase},
 *     or reject on error.
 *     assetMatchesBase is true if the asset matches the base layer; false if it required adjustment
 */
const fetchBitmapCanvas_ = function (costume, runtime, rotationCenter) {
    if (!costume || !costume.asset) { // TODO: We can probably remove this check...
        return Promise.reject('Costume load failed. Assets were missing.');
    }
    if (!runtime.v2BitmapAdapter) {
        return Promise.reject('No V2 Bitmap adapter present.');
    }

    return Promise.all([costume.asset, costume.textLayerAsset].map(asset => {
        if (!asset) {
            return null;
        }

        if (typeof createImageBitmap !== 'undefined') {
            return createImageBitmap(
                new Blob([asset.data], {type: asset.assetType.contentType})
            );
        }

        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = function () {
                resolve(image);
                image.onload = null;
                image.onerror = null;
            };
            image.onerror = function () {
                reject('Costume load failed. Asset could not be read.');
                image.onload = null;
                image.onerror = null;
            };
            image.src = asset.encodeDataURI();
        });
    }))
        .then(([baseImageElement, textImageElement]) => {
            const mergeCanvas = canvasPool.create();

            const scale = costume.bitmapResolution === 1 ? 2 : 1;
            mergeCanvas.width = baseImageElement.width;
            mergeCanvas.height = baseImageElement.height;

            const ctx = mergeCanvas.getContext('2d');
            ctx.drawImage(baseImageElement, 0, 0);
            if (textImageElement) {
                ctx.drawImage(textImageElement, 0, 0);
            }
            // Track the canvas we merged the bitmaps onto separately from the
            // canvas that we receive from resize if scale is not 1. We know
            // resize treats mergeCanvas as read only data. We don't know when
            // resize may use or modify the canvas. So we'll only release the
            // mergeCanvas back into the canvas pool. Reusing the canvas from
            // resize may cause errors.
            let canvas = mergeCanvas;
            if (scale !== 1) {
                canvas = runtime.v2BitmapAdapter.resize(mergeCanvas, canvas.width * scale, canvas.height * scale);
            }

            // By scaling, we've converted it to bitmap resolution 2
            if (rotationCenter) {
                rotationCenter[0] = rotationCenter[0] * scale;
                rotationCenter[1] = rotationCenter[1] * scale;
                costume.rotationCenterX = rotationCenter[0];
                costume.rotationCenterY = rotationCenter[1];
            }
            costume.bitmapResolution = 2;

            // Clean up the costume object
            delete costume.textLayerMD5;
            delete costume.textLayerAsset;

            return {
                canvas,
                mergeCanvas,
                rotationCenter,
                // True if the asset matches the base layer; false if it required adjustment
                assetMatchesBase: scale === 1 && !textImageElement
            };
        })
        .finally(() => {
            // Clean up the text layer properties if it fails to load
            delete costume.textLayerMD5;
            delete costume.textLayerAsset;
        });
};

const loadBitmap_ = function (costume, runtime, _rotationCenter) {
    return fetchBitmapCanvas_(costume, runtime, _rotationCenter)
        .then(fetched => {
            const updateCostumeAsset = function (dataURI) {
                if (!runtime.v2BitmapAdapter) {
                    // TODO: This might be a bad practice since the returned
                    // promise isn't acted on. If this is something we should be
                    // creating a rejected promise for we should also catch it
                    // somewhere and act on that error (like logging).
                    //
                    // Return a rejection to stop executing updateCostumeAsset.
                    return Promise.reject('No V2 Bitmap adapter present.');
                }

                const storage = runtime.storage;
                costume.asset = storage.createAsset(
                    storage.AssetType.ImageBitmap,
                    storage.DataFormat.PNG,
                    runtime.v2BitmapAdapter.convertDataURIToBinary(dataURI),
                    null,
                    true // generate md5
                );
                costume.dataFormat = storage.DataFormat.PNG;
                costume.assetId = costume.asset.assetId;
                costume.md5 = `${costume.assetId}.${costume.dataFormat}`;
            };

            if (!fetched.assetMatchesBase) {
                updateCostumeAsset(fetched.canvas.toDataURL());
            }

            return fetched;
        })
        .then(({canvas, mergeCanvas, rotationCenter}) => {
            // createBitmapSkin does the right thing if costume.rotationCenter is undefined.
            // That will be the case if you upload a bitmap asset or create one by taking a photo.
            let center;
            if (rotationCenter) {
                // fetchBitmapCanvas will ensure that the costume's bitmap resolution is 2 and its rotation center is
                // scaled to match, so it's okay to always divide by 2.
                center = [
                    rotationCenter[0] / 2,
                    rotationCenter[1] / 2
                ];
            }

            // TODO: costume.bitmapResolution will always be 2 at this point because of fetchBitmapCanvas_, so we don't
            // need to pass it in here.
            costume.skinId = runtime.renderer.createBitmapSkin(canvas, costume.bitmapResolution, center);
            canvasPool.release(mergeCanvas);
            const renderSize = runtime.renderer.getSkinSize(costume.skinId);
            costume.size = [renderSize[0] * 2, renderSize[1] * 2]; // Actual size, since all bitmaps are resolution 2

            if (!rotationCenter) {
                rotationCenter = runtime.renderer.getSkinRotationCenter(costume.skinId);
                // Actual rotation center, since all bitmaps are resolution 2
                costume.rotationCenterX = rotationCenter[0] * 2;
                costume.rotationCenterY = rotationCenter[1] * 2;
                costume.bitmapResolution = 2;
            }
            return costume;
        });
};

// Handle all manner of costume errors with a Gray Question Mark (default costume)
// and preserve as much of the original costume data as possible
// Returns a promise of a costume
const handleCostumeLoadError = function (costume, runtime) {
    // Keep track of the old asset information until we're done loading the default costume
    const oldAsset = costume.asset; // could be null
    const oldAssetId = costume.assetId;
    const oldRotationX = costume.rotationCenterX;
    const oldRotationY = costume.rotationCenterY;
    const oldBitmapResolution = costume.bitmapResolution;
    const oldDataFormat = costume.dataFormat;

    const AssetType = runtime.storage.AssetType;
    const isVector = costume.dataFormat === AssetType.ImageVector.runtimeFormat;
                
    // Use default asset if original fails to load
    costume.assetId = isVector ?
        runtime.storage.defaultAssetId.ImageVector :
        runtime.storage.defaultAssetId.ImageBitmap;
    costume.asset = runtime.storage.get(costume.assetId);
    costume.md5 = `${costume.assetId}.${costume.asset.dataFormat}`;
    
    const defaultCostumePromise = (isVector) ?
        loadVector_(costume, runtime) : loadBitmap_(costume, runtime);

    return defaultCostumePromise.then(loadedCostume => {
        loadedCostume.broken = {};
        loadedCostume.broken.assetId = oldAssetId;
        loadedCostume.broken.md5 = `${oldAssetId}.${oldDataFormat}`;

        // Should be null if we got here because the costume was missing
        loadedCostume.broken.asset = oldAsset;
        loadedCostume.broken.dataFormat = oldDataFormat;
        
        loadedCostume.broken.rotationCenterX = oldRotationX;
        loadedCostume.broken.rotationCenterY = oldRotationY;
        loadedCostume.broken.bitmapResolution = oldBitmapResolution;
        return loadedCostume;
    });
};

/**
 * Initialize a costume from an asset asynchronously.
 * Do not call this unless there is a renderer attached.
 * @param {!object} costume - the Scratch costume object.
 * @property {int} skinId - the ID of the costume's render skin, once installed.
 * @property {number} rotationCenterX - the X component of the costume's origin.
 * @property {number} rotationCenterY - the Y component of the costume's origin.
 * @property {number} [bitmapResolution] - the resolution scale for a bitmap costume.
 * @property {!Asset} costume.asset - the asset of the costume loaded from storage.
 * @param {!Runtime} runtime - Scratch runtime, used to access the storage module.
 * @param {?int} optVersion - Version of Scratch that the costume comes from. If this is set
 *     to 2, scratch 3 will perform an upgrade step to handle quirks in SVGs from Scratch 2.0.
 * @returns {?Promise} - a promise which will resolve after skinId is set, or null on error.
 */
const loadCostumeFromAsset = function (costume, runtime, optVersion) {
    costume.assetId = costume.asset.assetId;
    const renderer = runtime.renderer;
    if (!renderer) {
        log.warn('No rendering module present; cannot load costume: ', costume.name);
        return Promise.resolve(costume);
    }
    const AssetType = runtime.storage.AssetType;
    let rotationCenter;
    // Use provided rotation center and resolution if they are defined. Bitmap resolution
    // should only ever be 1 or 2.
    if (typeof costume.rotationCenterX === 'number' && !isNaN(costume.rotationCenterX) &&
            typeof costume.rotationCenterY === 'number' && !isNaN(costume.rotationCenterY)) {
        rotationCenter = [costume.rotationCenterX, costume.rotationCenterY];
    }
    return loadBitmap_(costume, runtime, rotationCenter, optVersion)
        .catch(error => {
            log.warn(`Error loading bitmap image: ${error}`);
            return handleCostumeLoadError(costume, runtime);
        });
};


/**
 * Load a costume's asset into memory asynchronously.
 * Do not call this unless there is a renderer attached.
 * @param {!string} md5ext - the MD5 and extension of the costume to be loaded.
 * @param {!object} costume - the Scratch costume object.
 * @property {int} skinId - the ID of the costume's render skin, once installed.
 * @property {number} rotationCenterX - the X component of the costume's origin.
 * @property {number} rotationCenterY - the Y component of the costume's origin.
 * @property {number} [bitmapResolution] - the resolution scale for a bitmap costume.
 * @param {!Runtime} runtime - Scratch runtime, used to access the storage module.
 * @param {?int} optVersion - Version of Scratch that the costume comes from. If this is set
 *     to 2, scratch 3 will perform an upgrade step to handle quirks in SVGs from Scratch 2.0.
 * @returns {?Promise} - a promise which will resolve after skinId is set, or null on error.
 */
const loadCostume = function (md5ext, costume, runtime, optVersion) {
    const idParts = md5ext.split('.')
    const md5 = idParts[0];
    const ext = idParts[1].toLowerCase();
    costume.dataFormat = ext;

    if (costume.asset) {
        // Costume comes with asset. It could be coming from image upload, drag and drop, or file
        return loadCostumeFromAsset(costume, runtime, optVersion);
    }

    // Need to load the costume from storage. The server should have a reference to this md5.
    if (!runtime.storage) {
        log.warn('No storage module present; cannot load costume asset: ', md5ext);
        return Promise.resolve(costume);
    }

    if (!runtime.storage.defaultAssetId) {
        log.warn(`No default assets found`);
        return Promise.resolve(costume);
    }

    const AssetType = runtime.storage.AssetType;
    const assetType = (ext === 'svg') ? AssetType.ImageVector : AssetType.ImageBitmap;

    const costumePromise = runtime.storage.load(assetType, md5, ext);

    let textLayerPromise;
    if (costume.textLayerMD5) {
        textLayerPromise = runtime.storage.load(AssetType.ImageBitmap, costume.textLayerMD5, 'png');
    } else {
        textLayerPromise = Promise.resolve(null);
    }

    return Promise.all([costumePromise, textLayerPromise])
        .then(assetArray => {
            if (assetArray[0]) {
                costume.asset = assetArray[0];
            } else {
                return handleCostumeLoadError(costume, runtime);
            }

            if (assetArray[1]) {
                costume.textLayerAsset = assetArray[1];
            }
            return loadCostumeFromAsset(costume, runtime, optVersion);
        })
        .catch(error => {
            // Handle case where storage.load rejects with errors
            // instead of resolving null
            log.warn('Error loading costume: ', error);
            return handleCostumeLoadError(costume, runtime);
        });
};
BL_load_costume = {
    loadCostume,
    loadCostumeFromAsset
};
};
//////////////////////////////////////////// end load-costume ////////////////////////////////////////////// 

// vm.editingTarget = a;
// vm.emitTargetsUpdate(false /* Don't emit project change */);
// vm.emitWorkspaceUpdate();
// vm.blockListener = proxy(vm.blockListener,"blocks",
//     (args)=>({type:args[0].type}),
//     (data)=>[{...data.args[0],type:data.extrargs.type}]
// )
// vm.blockListener = stProxy(vm.blockListener,"blocklist",null,null,null,()=>{vm.emitWorkspaceUpdate()})


// TODO: eventually maybe sync this
// vm.runtime.requestShowMonitor = anyproxy(vm.runtime,vm.runtime.requestShowMonitor,"showmonitor")
// vm.runtime.requestHideMonitor = anyproxy(vm.runtime,vm.runtime.requestHideMonitor,"showmonitor")


//sounds


vm.updateSoundBuffer = asyncEditingProxy(vm.updateSoundBuffer,'updatesound',null,null,(args)=>{
    let extrargs = {}
    return extrargs
},async (data)=>{
    let retArgs = data.args
    retArgs[2] = Uint8Array.from(Object.values(retArgs[2]))
    // WOW im proud of this one! Create an AudioBuffer from Uint8Array
    retArgs[1] = await (new AudioContext({sampleRate:retArgs[1].sampleRate})).decodeAudioData(retArgs[2].buffer.slice(0))
    // Wait no that requires async programming which i dont have here ugggggg
    // LOL JK GET DESTROYED NERRRDDDDDDDD i have the power of anime and copying code on mY SIDE!    
    return retArgs
})


vm.addSound = proxy(vm.addSound,"addsound",
    (args)=>{
        let targetName
        if(!!args[1]){targetName = targetToName(vm.runtime.getTargetById(args[1]))} else {targetName = targetToName(vm.editingTarget)}
        return {target:targetName}
    },
    (data)=>{
        let ret = [data.args[0],nameToTarget(data.extrargs.target)?.id]
        if(ret[0]?.asset?.data) {
            // adapted from scratch source 'file-uploader'
            ret[0].asset = vm.runtime.storage.createAsset(
                ret[0].asset.assetType, 
                ret[0].asset.dataFormat,
                Uint8Array.from(Object.values(ret[0].asset.data)),null,true);
            ret[0] = {
                name: ret[0].name,
                dataFormat: ret[0].asset.dataFormat,
                asset: ret[0].asset,
                md5: `${ret[0].asset.assetId}.${ret[0].asset.dataFormat}`,
                assetId: ret[0].asset.assetId
            };
        }
        return ret
    }
)





vm.duplicateSound = editingProxy(vm.duplicateSound,"duplicatesound")
vm.deleteSound = editingProxy(vm.deleteSound,"deletesound")
vm.renameSound = editingProxy(vm.renameSound,"renamesound")
vm.shareSoundToTarget = editingProxy(vm.shareSoundToTarget,"sharesound")
vm.reorderSound = proxy(vm.reorderSound,"reordersound",
    (args)=>({target:targetToName(vm.runtime.getTargetById(args[0]))}),
    (data)=>[nameToTarget(data.extrargs.target).id,data.args[1],data.args[2]],null)

// costumes    
vm.renameCostume = editingProxy(vm.renameCostume,"renamecostume")
vm.duplicateCostume = editingProxy(vm.duplicateCostume,"dupecostume")
vm.deleteCostume = editingProxy(vm.deleteCostume,"deletecostume")
vm.reorderCostume = proxy(vm.reorderCostume,"reordercostume",
    (args)=>({target:targetToName(vm.runtime.getTargetById(args[0]))}),
    (data)=>[nameToTarget(data.extrargs.target).id,data.args[1],data.args[2]],null,
    ()=>{vm.emitTargetsUpdate()})
vm.shareCostumeToTarget = editingProxy(vm.shareCostumeToTarget,'sharecostume',null,null,(args)=>({
    targettarget:BL_UTILS.targetToName(vm.runtime.getTargetById(args[1]))
}),(data)=>([data.args[0],BL_UTILS.nameToTarget(data.extrargs.targettarget)?.id]))
vm.addCostume = proxy(vm.addCostume,"addcostume",
    (args)=>{
        let targetName
        if(!!args[2]){targetName = targetToName(vm.runtime.getTargetById(args[2]))} else {targetName = targetToName(vm.editingTarget)}
        return {target:targetName}
    },
    (data)=>{
        let ret = [data.args[0],data.args[1],nameToTarget(data.extrargs.target)?.id,data.args[3]]
        if(ret[1]?.asset?.data) {
            // adapted from scratch source 'file-uploader'
            ret[1].asset = vm.runtime.storage.createAsset(
                ret[1].asset.assetType, 
                ret[1].asset.dataFormat,
                Uint8Array.from(Object.values(ret[1].asset.data)),null,true);
            ret[1] = {
                name: null,
                dataFormat: ret[1].asset.dataFormat,
                asset: ret[1].asset,
                md5: `${ret[1].asset.assetId}.${ret[1].asset.dataFormat}`,
                assetId: ret[1].asset.assetId
            };
        }
        return ret
    }
)

vm.addBackdrop = proxy(vm.addBackdrop,"addbackdrop",
    null,
    (data)=>{
        let ret = [data.args[0],data.args[1]]
        if(ret[1]?.asset?.data) {
            // adapted from scratch source 'file-uploader'
            ret[1].asset = vm.runtime.storage.createAsset(
                ret[1].asset.assetType, 
                ret[1].asset.dataFormat,
                Uint8Array.from(Object.values(ret[1].asset.data)),null,true);
            ret[1] = {
                name: null,
                dataFormat: ret[1].asset.dataFormat,
                asset: ret[1].asset,
                md5: `${ret[1].asset.assetId}.${ret[1].asset.dataFormat}`,
                assetId: ret[1].asset.assetId
            };
        }
        return ret
    }
)
// vm.updateBitmap = editingProxy(vm.updateBitmap,"updatebitmap",null,(_a,_b,data)=>{
//     let costumeIndex = getSelectedCostumeIndex()
//     // console.log(data)
//     // update paint editor if reciever is editing the costume
//     if(targetToName(vm.editingTarget) == data.extrargs.target && costumeIndex != -1 && costumeIndex == data.args[0]) {
//         // todo use some other method of refreshing the canvas
//         document.getElementById('react-tabs-4').click()
//         document.getElementById('react-tabs-2').click()
//     }
// },
//     (args)=>({height:args[1].height,width:args[1].width}),
//     (data)=>{
//         let args = data.args;
//         args[1] = new ImageData(Uint8ClampedArray.from(Object.values(args[1].data)), data.extrargs.width, data.extrargs.height);
//         return args
//     })
// vm.updateSvg = editingProxy(vm.updateSvg,"updatesvg",null,(_a,_b,data)=>{
//     let costumeIndex = getSelectedCostumeIndex()
//     // console.log(data)
//     // update paint editor if reciever is editing the costume
//     // todo: instead of checking with vm.editingTarget, use _a or _b
//     if(targetToName(_a) == data.extrargs.target && costumeIndex != -1 && costumeIndex == data.args[0]) {
//         let costume = vm.editingTarget.getCostumes()[costumeIndex]
//         let paper = getPaper()
//         console.log('switching paper costume')
//         if(!paper) {return;}
//         paper.switchCostume(
//             costume.dataFormat,
//             costume.asset.decodeText(),
//             costume.rotationCenterX,
//             costume.rotationCenterY,
//             paper.props.zoomLevelId,
//             paper.props.zoomLevelId)
//     }
// })
let oldUpdateBitmap = vm.updateBitmap
vm.updateBitmap = (...args)=>{
    // args: costumeIndex, bitmap, rotationCenterX, rotationCenterY, bitmapResolution
    oldUpdateBitmap.bind(vm)(...args);
    // vm runs emitTargetsUpdate after creating new asset
    etuListeners.push(async()=>{
        let target = BL_UTILS.targetToName(vm.editingTarget);

        let costumeIndex = args[0]
        let bitmapResolution = args[4]
        let costume = vm.editingTarget.getCostumes()[costumeIndex];
        let sendCostume = JSON.parse(JSON.stringify(costume))
        delete sendCostume.asset
        console.log(costume)
        let asset = costume.asset;
    
        let bitmap = args[1]
        let w=bitmap.sourceWidth === 0 ? 0 : bitmap.width;
        let h=bitmap.sourceHeight === 0 ? 0 : bitmap.height;

        // send costume to scratch servers
        let stored = await vm.runtime.storage.store(asset.assetType,asset.dataFormat,asset.data,asset.assetId);
        // get costume info to send

        liveMessage({meta:'vm.updateBitmap',costume:sendCostume,target,costumeIndex,assetType:asset.assetType,h,w,bitmapResolution})
    })
}
async function updateBitmap(msg) {
    console.log(msg)
    console.log(msg.costume.assetId)
    let target = BL_UTILS.nameToTarget(msg.target)
    let costume = target.getCostumes()[msg.costumeIndex]
    asset = await vm.runtime.storage.load(msg.assetType,msg.costume.assetId,msg.costume.dataFormat)

    costume.asset = asset
        Object.entries(msg.costume).forEach(entry=>{
            costume[entry[0]] = entry[1]
        }
    )

    vm.emitTargetsUpdate()

    // update paper 
    let selectedCostumeIndex = getSelectedCostumeIndex()
    if(BL_UTILS.targetToName(vm.editingTarget) == msg.target && selectedCostumeIndex != -1 && msg.costumeIndex == selectedCostumeIndex) {
        let costume = vm.editingTarget.getCostumes()[msg.costumeIndex]
        let paper = getPaper()
        console.log('switching paper costume')
        if(!paper) {return;}
        paper.switchCostume(
            costume.dataFormat,
            costume.asset.encodeDataURI(),
            costume.rotationCenterX,
            costume.rotationCenterY,
            paper.props.zoomLevelId,
            paper.props.zoomLevelId)
    }

    // update renderer costume skins [VERY IMPORTANT FOR RENDER!]
    await BL_load_costume.loadCostume(costume.md5,costume,vm.runtime)
    target.updateAllDrawableProperties()

    // image = new ImageData(new Uint8ClampedArray(asset.data.buffer),msg.w,msg.h)
    // console.log(image)

    /// TODO GET BITMAP SHOWING UP IN RENDER
    // const tmpCanvas = document.createElement('canvas');
    // tmpCanvas.width = msg.w;
    // tmpCanvas.height = msg.h;
    // const tmpCtx = tmpCanvas.getContext('2d');
    // const imageData = tmpCtx.createImageData(msg.w, msg.h);
    // imageData.data.set(asset.data);
    // tmpCtx.putImageData(imageData, 0, 0);
    // console.log(imageData)

    // vm.runtime.renderer.updateBitmapSkin(
    //     costume.skinId,
    //     tmpCanvas,
    //     msg.bitmapResolution,
    //     [costume.rotationCenterX / msg.bitmapResolution, costume.rotationCenterY / msg.bitmapResolution]
    // );
}









let oldUpdateSvg = vm.updateSvg
vm.updateSvg = (...args)=>{

    console.log('updateSvg args:',args)
    // args: costumeIndex, bitmap, rotationCenterX, rotationCenterY, bitmapResolution
    oldUpdateSvg.bind(vm)(...args);

// vm runs emitTargetsUpdate after creating new asset
{(async()=>{
    let target = BL_UTILS.targetToName(vm.editingTarget);

    let costumeIndex = args[0]
    let costume = vm.editingTarget.getCostumes()[costumeIndex];
    let sendCostume = JSON.parse(JSON.stringify(costume))
    delete sendCostume.asset
    console.log(costume)
    let asset = costume.asset;

    // send costume to scratch servers
    let stored = await vm.runtime.storage.store(asset.assetType,asset.dataFormat,asset.data,asset.assetId);
    // get costume info to send

    liveMessage({meta:'vm.updateSvg',costume:sendCostume,target,costumeIndex,assetType:asset.assetType})
})()}

}
async function updateSvg(msg) {
    console.log(msg)
    console.log(msg.costume.assetId)
    let target = BL_UTILS.nameToTarget(msg.target)
    let costume = target.getCostumes()[msg.costumeIndex]
    asset = await vm.runtime.storage.load(msg.assetType,msg.costume.assetId,msg.costume.dataFormat)

    costume.asset = asset
    Object.entries(msg.costume).forEach(entry=>{
        if(entry[0]=='skinId'){return}
        costume[entry[0]] = entry[1]
    })

    vm.emitTargetsUpdate()

    // update skin
    if (vm?.runtime?.renderer) {
        // costume data to xml svg dom text
        let svg = new TextDecoder().decode(costume.asset.data);
        vm.runtime.renderer.updateSVGSkin(costume.skinId, svg, [costume.rotationCenterX, costume.rotationCenterY]);
    }

    // update paper 
    let selectedCostumeIndex = getSelectedCostumeIndex()
    if(BL_UTILS.targetToName(vm.editingTarget) == msg.target && selectedCostumeIndex != -1 && msg.costumeIndex == selectedCostumeIndex) {
        let costume = vm.editingTarget.getCostumes()[msg.costumeIndex]
        let paper = getPaper()
        console.log('switching paper costume')
        if(!paper) {return;}
        paper.switchCostume(
            costume.dataFormat,
            costume.asset.encodeDataURI(),
            costume.rotationCenterX,
            costume.rotationCenterY,
            paper.props.zoomLevelId,
            paper.props.zoomLevelId)
    }

    // update renderer costume skins [VERY IMPORTANT FOR RENDER!]
    // await BL_load_costume.loadCostume(costume.md5,costume,vm.runtime)
    target.updateAllDrawableProperties()
}










// vm.updateBitmap = proxy(vm.updateBitmap,"updatebit",null,null,null,()=>{vm.emitTargetsUpdate();vm.emitWorkspaceUpdate()})
// vm.updateSvg = proxy(vm.updateSvg,"updatesvg",null,null,null,()=>{vm.emitTargetsUpdate();vm.emitWorkspaceUpdate()})
newTargetEvents = {} // targetName => [events...] //todo make let statement
function addNewTargetEvent(targetName, event) {
    if(!(targetName in newTargetEvents)) {
        newTargetEvents[targetName] = []
    }
    newTargetEvents[targetName].push(event)
}

// ()=>{pauseEventHandling = true},(
vm.addSprite = proxy(vm.addSprite,"addsprite",(args)=>{
    if(args[0] instanceof ArrayBuffer) {
    console.log(args)
    console.log('addsprite',args);
  return {spritearray:Array.from(new Uint8Array(args[0]))}
    } else return {}
},(data)=>(data.extrargs.spritearray ? [Uint8Array.from(data.extrargs.spritearray).buffer] : [...data.args]),null,(a,b)=>{ vm.setEditingTarget(a.id);  })
// vm.addSprite = proxy(vm.addSprite,"addsprite",(a)=>{console.log('🧟‍♂️ NEW SPRITE',a);window.sprite=a},null,null,(a,b)=>{ vm.setEditingTarget(a.id);  })
vm.duplicateSprite = proxy(vm.duplicateSprite,"duplicatesprite",
    // extrargs
    (args)=>({name:targetToName(vm.runtime.getTargetById(args[0]))}),
    (data)=>[nameToTarget(data.extrargs.name)?.id],
    ()=>{pauseEventHandling = true},
    ((a,b,n,result)=>{
        vm.setEditingTarget(a.id)
        pauseEventHandling = false;
        console.log('🔔🔔🔔🔔🔔🔔🔔🔔🔔🔔🔔🔔 stuff done! b, result',b,result); 
        newTargetEvents[b.sprite.name]?.forEach(event=>blockliveListener(event))
        
    }),null,null,()=>{
        // send replace blocks message
        liveMessage({meta:"vm.replaceBlocks",target:targetToName(vm.editingTarget),blocks:vm.editingTarget.blocks._blocks})
    })
    // Object.keys(vm.editingTarget.blocks._blocks).forEach(v=>{vm.editingTarget.blocks.deleteBlock(v)})
vm.deleteSprite = proxy(vm.deleteSprite,"deletesprite",
    (args)=>({name:targetToName(vm.runtime.getTargetById(args[0]))}),
    (data)=>[nameToTarget(data.extrargs.name).id])
vm.renameSprite = proxy(vm.renameSprite,"renamesprite",
    (args)=>({oldName:targetToName(vm.runtime.getTargetById(args[0]))}),
    (data)=>[nameToTarget(data.extrargs.oldName).id,data.args[1]])
vm.reorderTarget = proxy(vm.reorderTarget,"reordertarget");
// vm.shareBlocksToTarget = proxy(vm.shareBlocksToTarget,"shareblocks",
// (args)=>({toName:vm.runtime.getTargetById(args[1]).sprite.name}),
// (data)=>[data.args[0],vm.runtime.getSpriteTargetByName(data.extrargs.toName).id],null,()=>{vm.emitWorkspaceUpdate()})
let oldVmSetCloudProvider = vm.setCloudProvider.bind(vm);
vm.setCloudProvider = function(that) {
    if(!store?.getState()?.preview.projectInfo.is_published && !!that) {
        console.log('PROVIDER SET', that)
        that.projectId = blId
    }
    oldVmSetCloudProvider(that)
}
function connectToBlockliveCloud() {
    if(!blId) {return}
    vm.runtime.ioDevices.cloud.provider.projectId = blId
    vm.runtime.ioDevices.cloud.provider.openConnection()
}

let shareCreates = []
let lastDeletedBlock
waitFor(()=>(vm.editingTarget)).then(()=>{
    let oldCreateBlock = vm.editingTarget.blocks.__proto__.createBlock

    vm.editingTarget.blocks.__proto__.createBlock = function(...args) {
        if(isTargetSharing) {
            shareCreates.push(args)
        }
        return oldCreateBlock.call(this,...args)
    }

    let oldDeleteBlock = vm.editingTarget.blocks.__proto__.deleteBlock
    vm.editingTarget.blocks.__proto__.deleteBlock = function(...args) {
        lastDeletedBlock = this._blocks[args[0]]
        return oldDeleteBlock.call(this,...args)
    }
})

waitFor(()=>(vm.extensionManager)).then(()=>{
    vm.extensionManager.loadExtensionURL = 
    anyproxy(vm.extensionManager,vm.extensionManager.loadExtensionURL,"loadextensionurl")
})


let oldShareBlocksToTarget = vm.shareBlocksToTarget
let isTargetSharing = false
vm.shareBlocksToTarget = function(blocks, targetId, optFromTargetId) {
    shareCreates = []
    isTargetSharing = true
    return oldShareBlocksToTarget.bind(vm)(blocks, targetId, optFromTargetId).then(()=>{
        isTargetSharing = false
        let targetName = targetToName(vm.runtime.getTargetById(targetId))
        let fromTargetName = targetToName(vm.runtime.getTargetById(optFromTargetId))
        liveMessage({meta:"vm.shareBlocks",target:targetName,from:fromTargetName,blocks:shareCreates})
    })
}

function doShareBlocksMessage(msg) {
    let target = nameToTarget(msg.target)
    let targetId = target.id
    let fromTargetId = nameToTarget(msg.from)?.id
    // resolve variable conflicts
    // if(!!fromTargetId) {vm.runtime.getTargetById(fromTargetId).resolveVariableSharingConflictsWithTarget(msg.blocks, target);}

    // create new blocks in target
    msg.blocks.forEach(bargs=>{target.blocks.createBlock(...bargs)})
    target.blocks.updateTargetSpecificBlocks(target.isStage);

    if(targetId == vm.editingTarget.id) {vm.emitWorkspaceUpdate()}
    // update flyout for new variables and blocks
    if(!isWorkspaceAccessable()){return}
    getWorkspace().getToolbox().refreshSelection()
}



// no sure what this does but it might be useful at some point this.editingTarget.fixUpVariableReferences();

// port.postMessage();

function postCursorPosition() {
    let workspace = getWorkspace()
    if(!workspace) {return}
    let scrollX = workspace.scrollX
    let scrollY = workspace.scrollY
    let scale = workspace.scale
    let targetName = BL_UTILS.targetToName(vm.editingTarget)
    let editorTab = store?.getState()?.scratchGui?.editorTab?.activeTabIndex
    let cursor = {scrollX,scrollY,scale,targetName,editorTab}
    liveMessage({type:'setCursor',cursor})
}
setInterval(postCursorPosition,2500)


}



function createTagElement(username,color) {
    document.querySelector("rect.blockly-name-tag")?.remove()
    document.querySelector("text.blockly-name-tag")?.remove()
    var text = document.createElementNS("http://www.w3.org/2000/svg", "text")
    text.style.fontFamily = '"Helvetica Neue", Helvetica, Arial, sans-serif'
    text.setAttribute("fill", "white")
    text.style.fontSize = "1.25rem"
    text.style.transform = "translate(.5rem, -1rem)"
    var newUsername = username
    if (username.length > 12) {
        newUsername = username.slice(0, 12)+"..."
    }
    text.textContent = newUsername
    text.classList.add("blockly-name-tag")
    var rect = document.createElementNS("http://www.w3.org/2000/svg", "rect")
    rect.setAttribute("width", "12rem")
    rect.setAttribute("height", "2rem")
    rect.setAttribute("rx", ".5rem")
    rect.classList.add("blockly-name-tag")
    rect.style.transform = "translate(0rem, -2.2rem)"
    rect.setAttribute("fill", "rgb(238, 0, 255)")
    return [text, rect]
}

function setTag(tag, state) {
    if(state) {
        tag.classList.remove('turnOff')
        tag.classList.add('turnOn')
    } else {
        tag.classList.remove('turnOn')
        tag.classList.add('turnOff')
    }
}
function setOutline(blocks,state){
    if(state) {
        blocks.classList.remove('turnOff')
        blocks.classList.remove('turnedOff')
        blocks.classList.add('blocRect','turnOn')
    } else {
        blocks.classList.remove('turnOn')
        blocks.classList.remove('turnedOn')
        blocks.classList.add('blocRect','turnOff')
    }
    let animation = blocks.getAnimations().find(anim=>anim.animationName?.includes('outline'))
    animation.addEventListener('finish',()=>{
        if(state) {
            blocks.classList.remove('turnOn')
            blocks.classList.add('turnedOn')
        } else {
            blocks.classList.remove('turnOff')
            blocks.classList.add('turnedOff')
        } 
    })
}

function selectBlock(blocks,username,state,color) {
    blocks.style.outlineColor = color;
    let tag = blocks.querySelector('g' + '.tag')
    // let tag = blocks.querySelector(username + '.tag')
    if(!tag) {
        tag = createTagElement(username,color)
        blocks.appendChild(tag[1])
        blocks.appendChild(tag[0])
    }
    setOutline(blocks,state,color)
    setTag(tag[1],state,color)
    setTag(tag[0],state,color)
}


BL_BlockOutlinesUsers = {} // {username: {blockid?,styles:{}}}
BL_BlockTimeouts = {} // {blockid:timeoutid}
BL_BlockOutlinesBlocks = {} // {blockid:def}

function resetBlock(outlineObj, username) {
    let block = Blockly.getMainWorkspace().getBlockById(outlineObj.blockId) 
        ?? Blockly.getMainWorkspace().getCommentById(outlineObj.blockId) 
    if(!block) {return}
    let element = block.getSvgRoot()
    element.style.transition = 'all 0.5s'
    selectBlock(element, username,false)
}
function setBlockStyles(blockId,blockElem,newStyles, username) {
    let styles = {}
    blockElem.style.transition = 'transform 0.5s'
    selectBlock(blockElem, username,true,'rgb(238, 0, 255)')
    return {blockId,styles}
}



function outlineBlock(blockId, username) {
    if(blockId in BL_BlockOutlinesBlocks) {
        resetBlock(BL_BlockOutlinesBlocks[blockId], username)
        delete BL_BlockOutlinesBlocks[blockId]
        clearTimeout(BL_BlockTimeouts[blockId])
        delete BL_BlockTimeouts[blockId]
    }
    if(username in BL_BlockOutlinesUsers) {
        resetBlock(BL_BlockOutlinesUsers[username], username)
        delete BL_BlockOutlinesUsers[username]
    } 
    let workspace = Blockly.getMainWorkspace()
    if(!workspace) {return}
    let block = workspace.getBlockById(blockId) ?? workspace.getCommentById(blockId) 
    if(!block) {return}

    let blockElem = block.getSvgRoot();

    const blockResetDef = setBlockStyles(blockId,blockElem,
        {'outline':'solid 8px rgb(255,0,113)'}, username
    )
    BL_BlockOutlinesUsers[username] = blockResetDef;
    BL_BlockOutlinesBlocks[blockId] = blockResetDef;
    
    let timeoutId = setTimeout(()=>{resetBlock(blockResetDef, username)},2500) // clear outline in 5 seconds
    BL_BlockTimeouts[blockId] = timeoutId
}










/////........................ GUI INJECTS .........................//////
console.log('running gui inject...')
let shareDropdown = `
<container style="width:200px; row-gap: 5px; display:flex;flex-direction:column;background-color: hsla(260, 60%, 60%, 1);padding:10px; border-radius: 17px;">


<div  style="color:white;font-weight:normal;font-face='Helvetica Neue','Helvetica',Arial,sans-serif">   


<sharedWith style="display:flex;flex-direction: column;">
        <text style="display:flex;align-self: left;padding-left:4px; padding-top:5px;padding-bottom:5px;font-size: large;">
            Shared With 
            <unshare style="font-size:14px !important; align-self:center; margin-left:50px; justify-self:end; text-decoration:underline; color:#09004dd1;  cursor:pointer; padding:2px; background-color:rgba(255,255,255,0.15); border-radius:5px;" onclick="unshareBlocklive()">Unlink</unshare>
        </text>
        <sharedList  style="overflow: auto; max-height: 350px; display:flex; min-height: 20px; border-radius:10px;gap:5px;flex-direction: column;  ">
            <cell id="blModalExample" style="display:none; gap:10px;flex-direction: row; align-items: center;">
                <pic  style='width:40px; height:40px; border-radius: 100%; display:flex;background-position: center;background-size:cover; background-image:url("https://i.pinimg.com/originals/12/ff/9c/12ff9cd0f45317c362f0c87e2e55bd6c.jpg");';>
                </pic>
                <name onclick='window.open("https:\/\/scratch.mit.edu/users/" + this.innerText)', class="sharedName" style="cursor:pointer; max-width:122px;overflow:hidden; display:flex;align-self: center; font-size: large;font-weight:bold;">
                    WazzoTV
                </name>
                <x onclick="removeCollaborator(this.username)" style="cursor:pointer; display:flex; align:right;font-size:large; border-radius: 100%;padding: 0px;">
                    ✕
                </x>
            </cell>
        </sharedList>
    </sharedWith>
    <hr style="display: flex; width: 100%; height:1px;border:none;background-color:#16488f"></hr>
    <search style="display:flex;flex-direction: column; ">
        <text style="display:flex;flex-direction:column;align-self:  left;padding-top:5px;padding-bottom:5px;padding-left:4px; font-size: large;">
            Add Collaborators
            <textt style="font-size:small; color:#ffffffb3; font-style:italic">They must add you as a friend</textt>
            </text>
        <input id='searchy' style="color:black; display: flex;  margin-bottom:10px; align-self: center;border-radius: 10px; border-style: none; width:190px; height:30px">


    </input>
        <results style="display: flex; height: 40px;">
            <cell class="result" onclick="if(opening){opening=false;return;}addCollaborator(this.username);"  id="resultt" style="cursor:pointer; visibility: hidden; padding-right:20px; border-radius: 20px; display:flex; gap:10px;flex-direction: row; align-items: center;">
                <!-- <highlight class="resultHighlight" style="z-index: 0;position:absolute; width:240px; height: 50px; left:8px">

                </highlight> -->
                <pic id="resultPic" style='pointer-events:none;z-index: 1;width:40px; height:40px; border-radius: 100%; display:flex;background-position: center;background-size:cover;';>
                    <x id='plus' style="z-index: 1; color:rgb(69, 35, 136);margin-left:10px;display:flex; width:30px; border-radius: 100%;padding: 2px;font-weight: bold;font-size: x-large;">
                        +
                   </x>
                </pic>
                <name id="resultName" onclick='opening=true;window.open("https:\/\/scratch.mit.edu/users/" + this.innerText)' style="overflow:hidden;max-width:144px; z-index: 1;display:flex;align-self: center; font-size: large;font-weight:bold;">

                </name>
                
            </cell>
        </results>

   
    </search>

    </div>
    </container>

`
let shareScript = `{

opening = false
let result = document.querySelector('#resultName')
resultt = document.querySelector('#resultt')
let plus = document.querySelector('#plus')
let resultPic = document.querySelector('#resultPic')
blModalExample = document.querySelector('#blModalExample')

        earch =document.querySelector('#searchy')

        shareDivs = {}

        
        earch.addEventListener("keyup", function(event) {
  // Number 13 is the "Enter" key on the keyboard
  if (event.keyCode === 13) {
    // Cancel the default action, if needed
    addCollaborator(earch.value)
  }
});

        earch.oninput = async ()=>{
            console.log('hi')
            let currentSearching = earch.value.toLowerCase()
            let user = await getUserInfo(earch.value)
            if(currentSearching != earch.value.toLowerCase()) { return}
            if(user) {
           
            result.innerText = user.username
            result.parentNode.username = user.username

            resultt.style.visibility = 'visible'
            resultPic.style.backgroundImage = \`url('\${user.pic}')\`  
             } else {
                 resultt.style.visibility = 'hidden'
             }
        }

        function multiplyNode(node, count, deep) {
    for (var i = 0, copy; i < count - 1; i++) {
        copy = node.cloneNode(deep);
        node.parentNode.insertBefore(copy, node);
    }
}

multiplyNode(document.querySelector('cell'), 2, true);

// fetch(\`\${apiUrl}/share/\${blId}\`).then(res=>{res.json().then(json=>json.forEach(addCollaborator))})
}
`
let shareCSS = `

.sharedName:hover {
    text-decoration: underline;
}
#resultName:hover {
    text-decoration: underline;
}

.result:hover {
    background: rgba(255,255,255,0.2);
}
.blockliveloader {
    border: 3px solid rgba(255,0,113,1);
    border-top: 3px solid white;
    border-bottom: 3px solid white;
    border-radius: 50%;
    width: 13px;
    height: 13px;
    animation: spin 2s linear infinite;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }



.blActiveName {
    // visibility: hidden;
    filter: opacity(0%);

    // background-color: #ff00e6;
    color: #fff;
    transition: .2s;

    padding: 5px;
    border-radius: 6px;
    display: flex;
    align-self: center;
   
    /* Position the tooltip text - see examples below! */
    position: absolute;
    z-index: 1;

  }
  

  .blActiveUser:hover ~ .blActiveName {
    // visibility: visible;
    filter: opacity(100%);
  }






// highlight blocks


.tag{
    position: absolute;
    /* outline-color: rgb(255, 41, 216); */
    /* transform:translate(150px,50px) ;     */
    transform:translate(-110px,0px)  ;

}
.tagName{
    color:white;
    padding: 4px;
border-radius: 20px;

}

.usernameTag{   
    position: absolute;
    /* transform:rotate(-135deg)  ; */
    top:90px;

    font-size: 30px;
    font-family: helvetica;
    font-weight: bold;
    text-align: center;
    width: 100px;
  
    opacity: 0;

transition: .2s;


display: flex;
align-self: center;
align-items: center;
justify-content: center;
justify-items:center;

}

.tag:hover .usernameTag{
    opacity: 1;
}

.circle {
    position:absolute;
    width:100px;
    height:100px;
    border-radius: 100%;
    left:0px;
    top:0px;
    background: url("https://img.freepik.com/premium-photo/astronaut-outer-open-space-planet-earth-stars-provide-background-erforming-space-planet-earth-sunrise-sunset-our-home-iss-elements-this-image-furnished-by-nasa_150455-16829.jpg?w=2000");
    background-size: cover;
}

.square{    
    position:absolute;
    transform: translate(4px,3px) rotate(135deg);
    transform-origin: bottom right;
    width:50px;
    height:50px;
    top:0;
    left:0px;

}

.tag.turnOn {
    animation-name: indicateOn;
    animation-duration: .25s;
    animation-fill-mode:forwards;

}
.tag.turnOff{
    animation-name: indicateOff;
    animation-duration: .25s;
    animation-fill-mode:forwards;
}

@keyframes indicateOn {
    from {
        transform:translate(-170px,0px);
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}
@keyframes indicateOff {
    from {
        opacity: 1;

    }
    to {
        transform:translate(-170px,0px);
        opacity: 0;
    }
}


.blocRect{
    outline-style: solid;
    outline-width: 0px;
    border-radius: 20px;
}
/* .pinkOutline{
    outline-color: rgb(255, 41, 216);
}
.blueOutline{
    outline-color: rgb(0, 99, 165);
} */
.blocRect.turnOn {
    animation-name: outlineSelect;
    animation-duration: .25s;
    animation-fill-mode:forwards;
}
.blocRect.turnedOn {
    outline-offset: 0px;
}
.blocRect path {
    transition: stroke-width: .3s;
}

.turnedOn path:not([data-shapes="round"] > path) {
    stroke: rgb(255, 41, 216);
    stroke-width: 2.5px;
}

.blocRect.turnOff{
    animation-name: outlineUnselect;
    animation-duration: .25s;
    animation-fill-mode:forwards;
}

.blocRect.turnedOff{
    outline:none;
}

.blockly-name-tag {
    opacity: 1;
    transition: opacity .3s;
}

.turnedOff > .blockly-name-tag {
    opacity: 0;
}

@keyframes outlineSelect {
    from {
        outline-offset: 20px;
        outline-color: rgba(0,0,0,0);
    }
    to {
        outline-offset: 0px;
    }
}
@keyframes outlineUnselect {
    to {
        outline-offset: 20px;
        outline-color: rgba(0,0,0,0);
    }
    from {
        outline-offset: 0px;
    }
}



`




usersCache = {}

async function getUserInfo(username) {
    if(!username) {return}
    if(username?.toLowerCase() in usersCache && usersCache[username?.toLowerCase()]?.pk) {return usersCache[username?.toLowerCase()]}

    let res
    try{ 
        res=await (await fetch('https://scratch.mit.edu/site-api/users/all/' + username?.toLowerCase())).json()
    } catch(e) {
        return null
    }
    if(!res) {
        return null
    }

    let user = res.user
    user = getWithPic(user)
    usersCache[user.username.toLowerCase()] = user
    return user
}
function getWithPic(user) {
    user.pic = `https://uploads.scratch.mit.edu/get_image/user/${user.pk}_60x60.png`
    return user
}


async function addCollaboratorGUI (user,omitX){
    if(user.username.toLowerCase() in shareDivs) {return}
    if(!user) {return}

    let newCollab = blModalExample.cloneNode(-1)
    // console.log(newCollab)
    newCollab.style.display = 'flex'
    Array.from(newCollab.children).find(elem=>elem.localName =='name').innerText = user.username;
    let x = Array.from(newCollab.children).find(elem=>elem.localName =='x')
    if(omitX === true) {
        x.remove()
    } else {
        x.username = user.username;
    }
    Array.from(newCollab.children).find(elem=>elem.localName =='pic').style.backgroundImage = `url('${user.pic}')`  
    shareDivs[user.username.toLowerCase()] = newCollab
    blModalExample.parentNode.append(newCollab);

    resultt.style.visibility = 'hidden'
    earch.value = ''
    earch.oninput();
}

async function removeCollaboratorGUI (username) {
    if(!(username.toLowerCase() in shareDivs)) {return}
    shareDivs[username.toLowerCase()].remove()
    delete shareDivs[username.toLowerCase()]
}

function removeAllCollaboratorsGUI() {
    Object.values(shareDivs).forEach(div=>div.remove())
    shareDivs = {}
}

async function addCollaborator(username) {
    if(username.toLowerCase() in shareDivs) {return}
    let user = await getUserInfo(username)
    if(!user) {return}
    addCollaboratorGUI(user)
    chrome.runtime.sendMessage(exId,{meta:"shareWith",'username':user.username,id:blId,pk:user.pk})
}

function removeCollaborator(user) {
    removeCollaboratorGUI(user)
    chrome.runtime.sendMessage(exId,{meta:"unshareWith",user,id:blId})
}

function refreshShareModal() {
    if(!blId) {return}
    return new Promise(promRes=>{chrome.runtime.sendMessage(exId,{meta:'getShared',id:blId},async (res)=>{
        removeAllCollaboratorsGUI()
        for (boi of res) {if(!boi.pk) {console.log('oi!',boi);boi.pk = (await getUserInfo(boi.username)).pk};console.log(boi)}
        res.forEach(getWithPic)
        addCollaboratorGUI(res.shift(),true)
        res.forEach(addCollaboratorGUI)
        promRes()
    })})
}

function makeBlockliveButton() {
    let button = document.createElement('blocklive-init')
    button.className = 'button_outlined-button_1bS__ menu-bar_menu-bar-button_3IDN0'
    button.style.marginRight = '20px'
    button.style.paddingLeft = '7px'
    button.style.paddingRight = '7px'
    button.style.gap = '7px'
    // button.style.background = ' linear-gradient(90deg, rgba(51,0,54,1) 0%, rgba(255,0,113,1) 60%)'
    button.style.background = 'rgba(255,0,113,1)' // blocklive pink
    button.style.display = 'flex'
    button.style.flexDirection = 'row'

    let text = document.createElement('text')
    text.style.textAlign = 'center'
    text.innerHTML = "Blocklive<br>Share"

    let loader = document.createElement('loader')
    loader.className = 'blockliveloader'
    loader.style.display = 'none'
    button.appendChild(loader)
    button.appendChild(text)
    return button
}
function makeRevertButton() {
    let button = document.createElement('blocklive-init')
    button.id='blRevert'
    button.className = 'button_outlined-button_1bS__ menu-bar_menu-bar-button_3IDN0 community-button_community-button_2Lo_g'
    
    
    button.style.marginRight = '7px'
    button.style.marginLeft = '-10px'
    button.style.paddingLeft = '7px'
    button.style.paddingRight = '7px'
    button.style.gap = '7px'
    // button.style.background = ' linear-gradient(90deg, rgba(51,0,54,1) 0%, rgba(255,0,113,1) 60%)'
    // button.style.background = 'rgba(255,0,113,1)' // blocklive pink
    button.style.display = 'flex'
    button.style.flexDirection = 'row'
    button.style.backgroundColor = '#c2aaff'
    button.style.color = '#a00000'

    let text = document.createElement('text')
    text.style.textAlign = 'center'
    text.innerHTML = "Revert"

    button.appendChild(text)
    return button
}

let yeet = '⚠️'


function injectJSandCSS() {

    let dropdownScriptElem = document.createElement('script')
    dropdownScriptElem.innerHTML = shareScript
    document.head.appendChild(dropdownScriptElem)

    let styleInj = document.createElement('style')
    styleInj.innerHTML = shareCSS
    document.head.appendChild(styleInj)

    let styleInj2 = document.createElement('style')
    styleInj2.innerHTML = spriteDisplayCSS
    document.head.appendChild(styleInj2)
}

function addToCredits(text) {
    try{
    let oldDesc = store.getState().preview.projectInfo.description
    if(oldDesc.includes(text)) {return}
    let newDesc = oldDesc + (oldDesc=='' ? '' : '\n') + text;

    fetch(`https://api.scratch.mit.edu/projects/${scratchId}`, {
        "headers": {
            "accept": "application/json",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-site",
            "x-token": store.getState().session.session.user.token
        },
        "referrer": "https://scratch.mit.edu/",
        "referrerPolicy": "strict-origin-when-cross-origin",
        "body": `{\"description\":${JSON.stringify(newDesc)}}`,
        "method": "PUT",
        "mode": "cors",
        "credentials": "omit"
        });
        store.getState().preview.projectInfo.description = newDesc;
    } catch(e){
        console.error(e)
    }
}

function showBlStartError(err) {
    let rand=`a${Math.random().toString().substring(2)}`
      // stop spinny
    document.querySelector('loader.blockliveloader').style.display = 'none'

    document.querySelector('.blErr')?.remove()
    document.querySelector("blocklivecontainer > blocklive-init").insertAdjacentHTML('afterend',`<div class="${rand} blErr" style="background:#ffcdf2; outline:3px solid red; padding:4px; position:absolute; top:50px; border-radius:12px; color:red"></div>`)
    document.querySelector('.blErr').innerText=`There was an error:\n ${err}`
    setTimeout(()=>{document.querySelector(`.blErr.${rand}`)?.remove()},5000)

}

let blActivateClick = async ()=>{

    if(blockliveDeleted) {reloadAfterRestart=true} //todo write code so that it can do this without restarting
    if(reloadAfterRestart){
        finishedSavingCB.push(()=>{location.reload()})
        //stop spinny
        document.querySelector('loader.blockliveloader').style.display = 'none'
        reloadOnlineUsers()

        blShareClick()
    }
    
    // change onclick
    blockliveButton.onclick = undefined
    // set spinny icon
    document.querySelector('loader.blockliveloader').style.display = 'flex'

    // save project in scratch
    store.dispatch({type: "scratch-gui/project-state/START_MANUAL_UPDATING"})

    await waitFor(()=>(!isNaN(parseFloat(location.pathname.split('/')[2]))))
    scratchId = location.pathname.split('/')[2]

    let json = vm.toJSON()

    chrome.runtime.sendMessage(exId,{json,meta:'create',scratchId,title:store.getState().preview.projectInfo.title},async (response)=>{
        if(response.noauth || response.err) {
            showBlStartError(response.noauth ? 'Blocklive hasnt verified you yet.' : response.err)
            blockliveButton.onclick = blActivateClick
            return;
        }
        
       
        blId = response.id 

   

        // ACTIVATE BLOKLIVE!!!
        projectReplaceInitiated = true;
        pauseEventHandling = false
        liveMessage({meta:"myId",id:blId})
        activateBlocklive()
        // JOIN BLOCKLIVE SESSION!!!!
        liveMessage({meta:"joinSession"})
        readyToRecieveChanges = true
        await refreshShareModal()

        // add blocklive ref in instructions credits
        addToCredits('Get BIocklive for Live Collabs #bl')

        // stop spinny
        document.querySelector('loader.blockliveloader').style.display = 'none'

        // Set button onclick
        blockliveButton.onclick = blShareClick
        reloadOnlineUsers()

        blShareClick()

    })
}
let blShareClick = ()=>{console.log('clicked'); blDropdown.style.display = (blDropdown.style.display == 'none' ? 'flex' : 'none'); refreshShareModal() }

console.log('listening for share button')
blockliveButton = null
blDropdown = null

function doIOwnThis() {
    return store.getState().session.session.user.id == store.getState().preview.projectInfo.author.id;
}
function addButtonInjectors() {
listenForObj('#app > div > div.gui_menu-bar-position_3U1T0.menu-bar_menu-bar_JcuHF.box_box_2jjDp > div.menu-bar_main-menu_3wjWH > div:nth-child(4) > span',
    (bc)=>{
        // bc.children[1].children[0].innerHTML = "Become Blajingus"

        let container = document.createElement('blockliveContainer')
        container.style.display = 'flex'
        container.style.flexDirection = 'column'

        if(!doIOwnThis()) {return} // if 
        let button = makeBlockliveButton()
        blockliveButton = button
        let dropdown = document.createElement('blockliveDropdown')
        dropdown.innerHTML = shareDropdown
        dropdown.style.position = 'absolute'
        dropdown.style.top = '40px'
        dropdown.style.borderRadius = '17px'
        dropdown.style.boxShadow = '3px 7px 19px 3px rgba(0,0,0,0.48)'
        dropdown.style.display = 'none'
        blDropdown = dropdown

        button.onclick = ()=>{
            if(blId) {
                // if already is shared
                return blShareClick()
            } else {
                // if is regular scratch project
                return blActivateClick()
            }
        }
        document.addEventListener('click', (e)=>{if(e.target.nodeName != 'X' &&!dropdown.contains(e.target) && !button.contains(e.target)){dropdown.style.display = 'none'}})

        container.appendChild(button)
        container.appendChild(dropdown)
        bc.parentNode.parentNode.insertBefore(container,bc.parentNode)

        injectJSandCSS()

        refreshShareModal()

        addRevertButton()

    }
);

//// Inject active users display
listenForObj("#app > div > div.gui_menu-bar-position_3U1T0.menu-bar_menu-bar_JcuHF.box_box_2jjDp > div.menu-bar_account-info-group_MeJZP",(accountInfo)=>{
   
    let topBar = accountInfo.parentElement;

    // add panel
    let panel = document.createElement('div')
    panel.id = 'blUsersPanel'
    panel.style = "display: flex; jusify-content:center; align-items: center; gap: 3px; max-width: 300px; overflow: auto;"
    topBar.insertBefore(panel,accountInfo)
    // add chat
    addChatButton()

    let activeText = document.createElement('div')
    activeText.innerHTML = 'online:'
    activeText.style.color = '#104691'
    activeText.style.background = 'lightblue'
    activeText.style.padding = '2px'
    activeText.style.borderRadius= '3px'
    activeText.style.alignSelf= 'center'

    activeText.style.marginRight = '10px'
    panel.appendChild(activeText)

   setTopbarButtonVisibility()



    showCachedOnlineUsers();

})
}


function addRevertButton() {
    let mystuff = document.querySelector("div.menu-bar_account-info-group_MeJZP > a")
    let  seeProjectPage = document.querySelector("span.community-button_community-button_2Lo_g");

    if(!blId) {return}

    // let container = document.createElement('revertContainer')
    // container.style.display = 'flex'
    // container.style.flexDirection = 'column'

    // if(!doIOwnThis()) {return} // if 
    let button = makeRevertButton()
    // let dropdown = document.createElement('blockliveDropdown')
    // dropdown.innerHTML = shareDropdown
    // dropdown.style.position = 'absolute'
    // dropdown.style.top = '40px'
    // dropdown.style.borderRadius = '17px'
    // dropdown.style.boxShadow = '3px 7px 19px 3px rgba(0,0,0,0.48)'
    // dropdown.style.display = 'none'
    // blDropdown = dropdown

    button.onclick = ()=>{
        revertProject()
        // if(blId) {
        //     // if already is shared
        //     return blShareClick()
        // } else {
        //     // if is regular scratch project
        //     return blActivateClick()
        // }
    }

    // container.appendChild(button)
    // mystuff.after(button)
    seeProjectPage.before(button)

// delete tutorials text
   document.querySelector("span.menu-bar_tutorials-label_2tFBo").remove()

}



function revertProject() {
    let conf = window.confirm("Blocklive Revert:\nThis will delete recent blocklive edits and reset the project to the version that was saved in your mystuff before you opened it. \n - Use this if you think blocklive broke your project\n - You'll still have to click 'Save Now' to finalize the revert.\n\nClick OK to revert\nClick Cancel to cancel")
    if(!conf) {return}

    vm.loadProject(revertJSON)
}

let COLORS = ['teal','#c42b63']
let COLORS_BRIGHT = ['#00b9d1','#ff00e6']
let yo_1 = Math.round(Math.random());

function clearActive() {
    if(!document.getElementById('blUsersPanel')) {return}
    document.getElementById('blUsersPanel').innerHTML = ''

    let activeText = document.createElement('div')
    activeText.innerHTML = 'online:'
    activeText.style.color = '#104691'
    activeText.style.background = 'lightblue'
    activeText.style.padding = '2px'
    activeText.style.borderRadius= '3px'
    activeText.style.alignSelf= 'center'

    activeText.style.marginRight = '10px'
    document.getElementById('blUsersPanel').appendChild(activeText)
}

let bl_dudes = []
async function displayActive(users) {
    if(!users) {return}

    // console.log('activeusers',users)
    bl_dudes.forEach(dude=>dude?.remove())
    bl_dudes = []
    users?.forEach(user=>{
        if(user.username != uname) {
            bl_dudes.push(addDude(user?.cursor?.targetName,user.username))
        }
    })

    if(!document.getElementById('blUsersPanel')) {return}
    setTopbarButtonVisibility()

    let yo = yo_1
    let panel = document.getElementById('blUsersPanel')
    if(!panel) {return}
    for(let i = 0; i<users.length; i++) {

        let container = document.createElement('divv')
        container.onclick = ()=>{
            let u = users[i]

            let editingTargetId = BL_UTILS.nameToTarget(u.cursor.targetName).id
            if(u.cursor.targetName) {
                vm.setEditingTarget(editingTargetId)
            }

            let workspace = BL_UTILS.getWorkspace()
            if(!isNaN(u.cursor.editorTab)) {store.getState().scratchGui.editorTab.activeTabIndex = u.cursor.editorTab}
            if(u.cursor.scale && u.cursor.scrollX && u.cursor.scrollY) {
            if(!BL_UTILS.getWorkspace().startDragMetrics) {
                BL_UTILS.getWorkspace().startDragMetrics = BL_UTILS.getWorkspace().scrollbar.oldHostMetrics_
            }
            workspace.setScale(u.cursor.scale);
            workspace.scroll(u.cursor.scrollX,u.cursor.scrollY);}

            vm.emitTargetsUpdate();
        }

        // setInterval(()=>{
        // console.log('getBlockDragSurface',Blockly.getMainWorkspace().getBlockDragSurface(),
        //     'isDragging',Blockly.getMainWorkspace().isDragging()
        // )},500)


        panel.style = "display: flex; justify-content: center; align-items: center;"
        container.style.height = "70%"


        let user = document.createElement('img')
        if(!users[i].pk) {
            user.src = (await getUserInfo(users[i].username)).pic
        } else {
            user.src = `https://uploads.scratch.mit.edu/get_image/user/${users[i].pk}_60x60.png`
        }
        user.style.borderRadius = '10px'
        // user.style.height = '100%'
        user.style.width = '33.59px'
        user.style.height = '33.59px'

        user.style.objectFit = 'cover'
        yo++;
        yo = yo%COLORS.length
        user.style.outline = '3px solid ' + COLORS[yo]
        // user.style.outline = '3px solid ' + COLORS[Math.floor(Math.random()*COLORS.length)]
        user.className = 'blActiveUser'

        let tooltip = document.createElement('div');
        tooltip.innerText = users[i].username
        tooltip.style.backgroundColor = COLORS_BRIGHT[yo]
        tooltip.className = 'blActiveName'
        container.appendChild(user)
        container.appendChild(tooltip)
        panel.appendChild(container)
    }
}

blCursors=null;
function reloadOnlineUsers() {
    chrome.runtime.sendMessage(exId,{meta:'getActive',id:blId},(res)=>{
        if(JSON.stringify(blCursors)==JSON.stringify(res)) {return}
        blCursors = res
        clearActive()
        try{displayActive(res)}catch(e){console.error(e)}
        // moveMyBubble()
    })
}
function showCachedOnlineUsers() {
    clearActive()
    try{displayActive(blCursors)}catch(e){console.error(e)}
}

setInterval(reloadOnlineUsers,2500)
setTimeout(reloadOnlineUsers,500)


//////////////////// LOADING OVERLAY ////////////////////

const overlayHTML = `
<loading-content>
<img src="https://assets.scratch.mit.edu/9a5f5b45565e6e517bc39bba7d90395e.svg" id="bl-load-logo">
<div class="bl-loading-text">Loading blocklive...</div>
</loading-content>
</img>`
const overlayCSS = `
loading-content{
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-items: center;
    justify-content: center;
    height: 100%;
    scale:70%;
}
blocklive-loading{
    z-index:10000;
    position:fixed;
    width: 100vw;
    height: 100vh;
    /* backdrop-filter: blur(12px); */
    transition: 0.34s;
}
.bl-loading-text{
    animation: .6s ease-in-out 0.3s infinite alternate bl-logo-loading;
    /* animation: name duration timing-function delay iteration-count direction fill-mode; */

    font-family: 'Helvetica Neue','Helvetica',Arial,sans-serif;
    font-style: italic;
    font-weight:500;
    font-size: 40px;
    color:rgb(255, 0, 217);

    transition: 0.34s;
    opacity: 0%;


}
#bl-load-logo{
    display: flex;
    animation: .6s ease-in-out infinite alternate bl-logo-loading;
    scale:400%;
    opacity: 0%;
    transition: 0.34s;

}

@keyframes bl-logo-loading {
    from{
        transform: perspective(400px) rotateX(0deg) rotateY(5deg);
    }
    to{
        transform: perspective(400px) rotateX(0deg) rotateY(-5deg);
    }
}
`
function finishBLLoadingAnimation() {
    try{
    document.querySelector('blocklive-loading').style.backdropFilter = ' blur(0px)'
    document.querySelector('#bl-load-logo').style.scale = '500%'
    document.querySelector('#bl-load-logo').style.opacity = '0%'
    document.querySelector('.bl-loading-text').style.opacity = '0%'

    setTimeout(()=>{document.querySelector('blocklive-loading').style.display = 'none'},601)
    } catch (e) {console.error(e)}
}

function startBLLoadingAnimation() {
    try{
        document.querySelector('blocklive-loading').style.display = 'block'
        document.querySelector('blocklive-loading').style.backdropFilter = ' blur(12px)'
        document.querySelector('#bl-load-logo').style.scale = '100%'
        document.querySelector('#bl-load-logo').style.opacity = '100%'
        document.querySelector('.bl-loading-text').style.opacity = '100%'
    } catch (e) {console.error(e)}
}

function injectLoadingOverlay() {
    try{
        let styleInj = document.createElement('style')
    styleInj.innerHTML = overlayCSS
    document.head.appendChild(styleInj)

    let loadingOverlay = document.createElement('blocklive-loading')
    loadingOverlay.innerHTML = overlayHTML
    document.body.appendChild(loadingOverlay)

}    catch (e) {console.error(e)}
}



let chatCss = `

.chatdot {
    visibility:hidden;
    position: absolute;
    height: 1.05em;
    /* width: 15px; */
    /* min-width: 15px; */
    left: 17px;
    top: -3px;
    background-color: red;
    border-radius: 1em;
    display: inline-block;
    font-size: 16px;
    text-align: center;
    /* padding-left: 4px; */
    /* border-right: 4px solid; */
    padding: 0 0.25em;
    line-height: 1em;
}

.textbubbleemoji{
    font-size: 27px;
    position:relative;
}
.bl-chat-toggle-button{
    user-select: none;
    display: flex;
    justify-content: center;
    align-items: center;
    width:33.59px;
    height:33.59px;
    border-radius: 100%;
    border: solid rgb(203, 203, 203) 3px;
    background-color: rgb(255, 255, 255);
    transition: 0.2s;

    margin-left:10px;
}
.bl-chat-toggle-button:hover{
    /* box-shadow: 0 0 15px 0 rgba(255, 0, 208, 0.8); */
    box-shadow: 5px 5px 3.4px 0px rgba(0,0,0,0.5);
    transform:translate(-3px,-3px)
}
.bl-chat-toggle-button:active{
    /* box-shadow: 0 0 15px 0 rgba(255, 0, 208, 0.8); */
    box-shadow: 0px 0px 0px 0px rgba(0,0,0,0.5);
    transform: none;
    transition:0.1s;
}


.mymsg{
    align-self: flex-end;
}
bl-msg-space{height:20px}
bl-msg{
    border:solid rgba(0, 0, 0, 0.189);
    border-radius: 10px;
    padding: 5px;
    max-width: 80%;
    margin-left: 15px;
    background-color: rgb(255, 255, 255);
    overflow-wrap: anywhere;
}
bl-msg-sender-name{
    font-style:italic;
    color:rgb(73, 73, 73);
}
bl-msg-sender{
    display: flex;
    flex-direction: row;
    gap:5px;
}
bl-msg-sender-img{
    background-image: url(https://uploads.scratch.mit.edu/get_image/user/default_60x60.png);
    background-size: contain;
    width:25px;
    height:25px;
    border-radius: 10px;
}

bl-chat-send-button{
    user-select: none;
    min-width: 34px;
    height: 34px;
    line-height: 35px;
    background-color: rgb(255, 54, 171);
    color:white;
    border-radius: 12px;
    text-align: center;
    box-shadow: 0px 0px 10px 0px rgba(0,0,0,0.4);

    transition: 0.2s scale;
}
bl-chat-send-button:hover{
    scale: 112%;
}
bl-chat-send{
    display: flex;
    flex-direction: row;
    align-items: center;
    margin:10px;
    margin-top:1px;
    gap:7px;
    /* min-height:24px; */
    /* max-height:150px; */
}

bl-chat-input{
    flex-grow: 1;
    border-radius: 16px;
    box-shadow: 0px 0px 10px 0px rgba(0,0,0,0.4);
    max-height:150px;
    min-height:40px;
    overflow-y: auto;
    text-overflow: clip;
    overflow-wrap: anywhere;


    font-size:17px;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    padding:6px;
    background-color: white;

    /* text-align: center; */
}
bl-chat-input:focus{
    outline: none;
}

bl-chat-msgs{
    display: flex;
    flex-shrink:1;
    flex-direction: column;
    padding:10px;
    overflow-y: scroll;
    /* height:400px; */
    flex-grow:1;

    /* min-height: 15px; */
    /* width: 100%; */
    padding-top:5px;
    font-family: Tahoma, sans-serif;
    font-size: 20px;
    line-height: 20px;
    color:rgb(38, 38, 38);
    gap:3px;
    align-items: flex-start;
}
bl-chat-msgs::-webkit-scrollbar { width: 0 !important }
bl-chat-msgs { overflow: -moz-scrollbars-none; }

bl-chat-head-x{
    cursor:pointer;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 22px;
    transform: rotate(45deg);
    font-weight: bold;

    border-radius: 100%;
    padding:5px;
    width:20px;
    height:20px;
    line-height: 16px;
    text-align: center;
    background-color: rgb(200, 1, 104);
    margin-right:6px;
    color:white;
    transition: 0.2s scale;
}
bl-chat-head-x:hover{
    scale: 112%;
}
bl-chat-head-filler{
    display: flex;
    flex-grow:1;
}
bl-chat-head-text{
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-weight: bold;
    font-size: 20px;
    margin-left: 20px;
    color:white;
}
bl-chat-head {
    cursor:move;
    user-select: none;
    display: flex;
    flex-direction: row;
    align-items: center;
    width: 100%;
    height:45px;
    flex-shrink:0;
    /* min-height:45px; */
    background-color: rgb(255, 0, 157);
    border-radius: 7px;
    box-shadow: 0px 0px 21px 0px rgba(0,0,0,0.5);
}

bl-chat{
    z-index:1000;
    position: absolute;
    border-radius: 20px;

    display:flex;
    width:242px;
    height:365px;
    min-width:176px;
    min-height:176px;
    flex-direction: column;

    background-color: rgb(248, 248, 248);

    overflow: hidden;

    box-shadow: 0px 0px 21px 0px rgba(0,0,0,0.5);
    resize: both;

    transition: 0.2s scale;
    transform-origin: center;

}`
function injectChatCSS() {
    try{
        let styleInj = document.createElement('style')
        styleInj.innerHTML = chatCss
        document.head.appendChild(styleInj)
}    catch (e) {console.error(e)}
}
function addChat() {
try{
    injectChatCSS()

    let blChat = document.createElement('bl-chat')
    blChat.id = 'bl-chat'
    blChat.innerHTML = blChatHTML
    // blChat.style.visibility = 'hidden'
    document.body.appendChild(blChat)

    let chatbox = document.querySelector('bl-chat')
    dragElement(chatbox)

    document.querySelector('bl-chat-input').addEventListener('keydown',(e)=>{
        if(e.keyCode == 13) {
            postMessageBubble()
            e.preventDefault()
        }
    })
    document.querySelector('bl-chat-send-button').onclick = postMessageBubble
    chatbox.style.scale = 0

    //// get own username, then populate chat history
    chrome.runtime.sendMessage(exId,{meta:'getUsernamePlus'},(userData)=>{
        uname = userData.uname
        let blToken = userData.currentBlToken
        fetch(apiUrl + '/chat/' + blId,{headers:{uname,authorization:blToken}}).then(async res=>{
            let chatHistory = await res.json()
            chatHistory.forEach(msg=>addMessage(msg))
        })
    })
    backspaceFix()
} catch (e) {console.error(e)}
}
function addChatButton() {
    try{
        let chatElem = document.createElement('div')
        chatElem.id = 'blChatButton'
        chatElem.classList.add('bl-chat-toggle-button')
        chatElem.innerHTML = `<span class="textbubbleemoji" onclick="toggleChat()"><span>💬</span><span class="chatdot"></span></span>`
        let panel = document.getElementById('blUsersPanel')

        let newPanel = document.createElement('div')
        newPanel.id='noRefreshPanel'
        newPanel.style = "display: flex; jusify-content:center; align-items: center; gap: 3px; max-width: 300px;"
        panel.parentElement.insertBefore(newPanel,panel.nextElementSibling)

        newPanel.appendChild(chatElem)

        setChatUnread(chatUnreadCount)

        if(!blId) {chatElem.style.visibility = 'hidden'}
        else {chatElem.style.visibility = 'visible'}

    }catch(e) {console.error(e)}
}
let chatUnreadCount = 0
function incChatUnread() {
    setChatUnread(chatUnreadCount+1)
}
function setChatUnread(num) {
    chatUnreadCount = num;
    let chatdot=document.querySelector('.chatdot');
    chatdot.innerText = num;
    chatdot.style.visibility = num==0 ? 'hidden' : 'visible'
}

let blChatHTML = `
<bl-chat-head id="bl-chat-banner">
    <bl-chat-head-text>Blocklive Chat</bl-chat-head-text>
    <bl-chat-head-filler></bl-chat-head-filler>
    <bl-chat-head-x onclick="toggleChat(false)">+</bl-chat-head-x>
</bl-chat-head>
<bl-chat-msgs>
    <bl-msg-space></bl-msg-space>
</bl-chat-msgs>
<bl-chat-send>
    <bl-chat-input contenteditable="true"></bl-chat-input>
    <bl-chat-send-button>⬆</bl-chat-send-button>
</bl-chat-send>`



function dragElement(elmnt) {
  var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  if (document.getElementById(elmnt.id + "-banner")) {
    // if present, the header is where you move the DIV from:
    document.getElementById(elmnt.id + "-banner").onmousedown = dragMouseDown;
  } else {
    // otherwise, move the DIV from anywhere inside the DIV:
    elmnt.onmousedown = dragMouseDown;
  }

  function dragMouseDown(e) {
    e = e || window.event;
    e.preventDefault();
    // get the mouse cursor position at startup:
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    // call a function whenever the cursor moves:
    document.onmousemove = elementDrag;
  }

  function elementDrag(e) {
    e = e || window.event;
    e.preventDefault();
    // calculate the new cursor position:
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    // set the element's new position:
    elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
    elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
  }

  function closeDragElement() {
    // stop moving when mouse button is released:
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

// msg: {text, sender}
lastSender = ''
uname = ''
let pingUrl = "https://assets.scratch.mit.edu/internalapi/asset/cf51a0c4088942d95bcc20af13202710.wav/get/";
// chrome.runtime.sendMessage(exId,{meta:'getPingUrl'},url=>{
//     pingUrl = url;
// });
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

async function addMessage(msg, notif) {
    let msgsElem = document.querySelector('bl-chat-msgs')
    if(msg.sender != lastSender) {
        let unameElem = document.createElement('bl-msg-sender')
        unameElem.innerHTML = `
        <bl-msg-sender-img></bl-msg-sender-img>
        <bl-msg-sender-name>${sanitize(msg.sender)}</bl-msg-sender-name>`
        lastSender = msg.sender
        if(msg.sender == uname) {unameElem.classList.add('mymsg')}
        msgsElem.appendChild(unameElem)
        
        {(async()=>{unameElem.querySelector('bl-msg-sender-img').style.backgroundImage = `url(${(await getUserInfo(msg.sender)).pic})`})()}
    }
    let msgElem = document.createElement('bl-msg')
    msgElem.innerText = msg.text 
    if(msg.sender == uname) {msgElem.classList.add('mymsg')}
    msgsElem.appendChild(msgElem)

    msgsElem.scrollTop = msgsElem.scrollHeight;


    if(notif) {
        if(!isChatOpen()) {
            incChatUnread();
        }
        if(!isChatOpen() || !document.hasFocus()) {
            liveMessage({meta:"chatnotif",project:store.getState().preview.projectInfo.title, sender:msg.sender, text:msg.text, avatar:(await getUserInfo(msg.sender)).pic})
        }
        if(await isPingEnabled()) {
            playSound(pingUrl)
        }
    }
}

function isPingEnabled(){
    return new Promise(ret=>
        chrome.runtime.sendMessage(exId,{meta:'isPingEnabled'},ret)
    )
}
function playSound(url) {
    var a = new Audio(url);
    a.play();
}

function postMessageBubble() {
    let inputElem = document.querySelector('bl-chat-input')
    let messageText = inputElem.innerText
    messageText = messageText.trim()
    if(messageText=='') {return}

    
    let messageObj = {sender:uname,text:messageText};
    addMessage(messageObj);
    liveMessage({meta:'chat',msg:messageObj})

    inputElem.innerText = ''
}

function toggleChat(state) {
    let chatbox = document.querySelector('bl-chat')
    if(state===undefined) {
        // chatbox.style.visibility = chatbox.style.visibility=='hidden' ? 'visible' : 'hidden'
        chatbox.style.scale = chatbox.style.scale==0.8 ? 0 : 0.8
        // chatbox.style.scale = chatbox.style.transformOrigin='top left'
    } else {
        // chatbox.style.visibility = state ? 'visible' : 'hidden'
        chatbox.style.scale = state ? 0.8 : 0
        // chatbox.style.scale = chatbox.style.transformOrigin='center'
    }
    if(isChatOpen()) {setChatUnread(0)}
}
function isChatOpen() {
    let chatbox = document.querySelector('bl-chat')
    return chatbox.style.scale = chatbox.style.scale==0.8
}


function getSpriteBoxElem(spriteName) {
    let elem = Array.from(document.getElementsByClassName('sprite-selector_scroll-wrapper_3NNnc box_box_2jjDp')[0].querySelectorAll('div')).find(elem=>elem.innerHTML==spriteName)
    return elem?.parentElement?.parentElement
}
function addDude(spritename,dudename) {
    let spriteBox = getSpriteBoxElem(spritename);
    if(spritename==BL_UTILS.stageName) {spriteBox = document.querySelector("#app > div > div.gui_body-wrapper_-N0sA.box_box_2jjDp > div > div.gui_stage-and-target-wrapper_69KBf.box_box_2jjDp > div.gui_target-wrapper_36Gbz.box_box_2jjDp > div > div.target-pane_stage-selector-wrapper_qekSW > div.stage-selector_stage-selector_3oWOr.box_box_2jjDp")}
    if(!spriteBox) {return}
    let panel = spriteBox?.querySelector('.sdPanel');
    if(!panel) {
        // add sd panel
        panel = document.createElement('div')
        panel.classList.add('sdPanel')
        spriteBox.appendChild(panel)
    }
    let dude = document.createElement('div')
    dude.classList.add('sdCircle')
    panel.appendChild(dude)
    getUserInfo(dudename).then(info=>dude.style.backgroundImage=`url(${info.pic})`)

    return dude;
}

let spriteDisplayCSS = `
.sdPanel{
    display:flex;
    flex-wrap:wrap;
    flex-direction:row;
    width:70%;
    position:absolute;
    left:3px;
    top:3px;
    gap:-1px;
}
.sdCircle{
    width:20px;
    height:20px;
    border-radius:100%;
    outline: solid 2px #ff24e2;
    background-size:cover;
}
`

function moveMyBubble() {
    try{
        blCursors.find(b=>b.username==uname).cursor.targetName=BL_UTILS.targetToName(vm.editingTarget)
        clearActive()
        try{displayActive(blCursors)}catch(e){console.error(e)}
    }catch(e){console.error(e)}
}

function backspaceFix() {
    document.querySelector("#bl-chat > bl-chat-send > bl-chat-input").addEventListener('keydown',(e)=>{
        e.stopPropagation();
    })
    document.addEventListener('mousedown',e=>{
        if(e.target!=document.querySelector("#bl-chat > bl-chat-send > bl-chat-input") && 
            document.activeElement==document.querySelector("#bl-chat > bl-chat-send > bl-chat-input")) {
                document.activeElement.blur()
        }
    })
}


///////// revert projects /////////