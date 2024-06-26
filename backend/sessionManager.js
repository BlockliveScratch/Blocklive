import fs from 'fs'
import fsp from 'fs/promises'
import path, { sep } from 'path';
import sanitize from 'sanitize-filename';
import { blocklivePath, lastIdPath, saveMapToFolder, saveMapToFolderAsync, scratchprojectsPath } from './filesave.js';
import { Blob } from 'node:buffer'
import { countPopup, countRecent, countRecentRealtime, countRecentShared, countUniquePopup } from './recentUsers.js';
import { getAuthStats } from './scratch-auth.js';
import { numWithCreds, numWithoutCreds } from './index.js';

const OFFLOAD_TIMEOUT_MILLIS = 45 * 1000 // you get two minutes before the project offloads

class BlockliveProject {

    // a note on project versioning:
    // a change's version refers to the version that the project is on after a change is played
    // a jsonVersion refers to the version of the last change included in a json
    // the next change to be played must be a client's current blVersion + 1

    static fromJSON(json) {
        let ret = new BlockliveProject(json.title)
        Object.entries(json).forEach(entry => {
            ret[entry[0]] = entry[1]
        })
        return ret;
    }

    // toJSON() { // this function makes it so that the file writer doesnt save the change log. remove it to re-implement saving the change log
    //     let ret = { ...this }

    //     let n = 5; // trim changes on save
    //     n = Math.min(n, ret.changes.length);

    //     ret.indexZeroVersion += ret.changes.length - n;
    //     ret.changes = ret.changes.slice(-n)

    //     // if the changes list string is more than 20 mb, dont write changes
    //     if (new Blob([JSON.stringify(ret.changes)]).size > 2e7) {
    //         ret.indexZeroVersion += ret.changes.length
    //         ret.changes = [];
    //     }

    //     return ret;
    // }


    // projectJSON
    // projectJSONVersion = 0
    version = -1
    changes = []
    lastTime = Date.now();
    lastUser = "";
    title;

    constructor(title) {
        this.title = title
    }

    recordChange(change) {
        this.trimCostumeEdits(change)
        this.changes.push(change)
        this.version++;
        this.lastTime = Date.now()
    }

    // removes previous bitmap/svg updates of same sprite to save loading time
    trimCostumeEdits(newchange) {
        if (newchange.meta == "vm.updateBitmap" || newchange.meta == "vm.updateSvg") {
            let target = newchange.target
            let costumeIndex = newchange.costumeIndex
            let limit = 20;
            for (let i = this.changes.length - 1; i >= 0 && i >= this.changes.length - limit; i--) {
                let change = this.changes[i];
                let spn = change?.data?.name
                if (spn == "reordercostume" || spn == 'renamesprite') { break }
                if ((change.meta == "vm.updateBitmap" || change.meta == "vm.updateSvg") && change.target == target && change.costumeIndex == costumeIndex) {
                    this.changes[i] = { meta: 'version++' }
                }
            }
        }
    }

    getChangesSinceVersion(lastVersion) {
        return this.changes.slice(Math.max(0, lastVersion - this.getIndexZeroVersion()))
    }
    getIndexZeroVersion() {
        return this.version - this.changes.length + 1
    }

    // trim changes to lenght n
    trimChanges(n) {
        // bound n: 0 < n < total changes lenght
        if (!n) { n = 0 }
        n = Math.min(n, this.changes.length);

        // this.indexZeroVersion += this.changes.length - n;
        this.changes = this.changes.slice(-n)
        // LOL DONT
        // for(let i=0; i<this.version-1; i++) {
        //     this.changes[i] = {r:1}
        // }
    }
}

class BlockliveClient {
    isReady = true;
    username
    socket

    cursor = { targetName: null, scale: 1, scrollX: 0, scrollY: 0, cursorX: 0, cursorY: 0, editorTab: 0 }

    constructor(socket, username) {
        this.socket = socket
        this.username = username
    }

    trySendMessage(data) {
        if (this.isReady) { this.socket.send(data) }
    }

    id() {
        return this.socket?.id
    }

}

class BlockliveSess {
    connectedClients = {}
    project
    id

    constructor(project, id) {
        this.project = project
        this.id = id
    }

    addClient(client) {
        this.connectedClients[client.id()] = client
        this.getWonkySockets()
    }
    removeClient(id) {
        let username = this.connectedClients[id]?.username
        delete this.connectedClients[id]
        return username
    }

    getClientFromSocket(socket) {
        return this.connectedClients[socket?.id]
    }

    getConnectedUsernames() {
        return [...(new Set(Object.values(this.connectedClients).map(client => client.username?.toLowerCase())))]
    }

    // get one client per username
    getConnectedUsersClients() {
        let clients = {}
        Object.values(this.connectedClients).forEach(client => { clients[client.username.toLowerCase()] = client })
        return clients
    }

    sendChangeFrom(socket, msg, excludeVersion) {
        Object.values(this.connectedClients).forEach(client => {
            if (!socket || (socket.id != client.id())) {
                // console.log('sending message to: ' + client.username + " | type: " + msg.type)
                client.trySendMessage({
                    type: 'projectChange',
                    blId: this.id,
                    version: excludeVersion ? null : this.project.version,
                    msg,
                    from: socket?.id,
                    user: this.getClientFromSocket(socket)?.username
                })
            }
        })
    }

    onProjectChange(socket, msg) {
        let client = this.getClientFromSocket(socket);
        msg.user = client?.username
        this.project.recordChange(msg)
        this.project.lastUser = client ? client.username : this.project.lastUser
        this.sendChangeFrom(socket, msg)
    }

    getWonkySockets() {
        let wonkyKeys = []
        Object.entries(this.connectedClients).forEach(entry => {
            let socket = entry[1].socket
            if (socket.disconnected || socket.id != entry[0]) {
                wonkyKeys.push(entry[0])
                console.log('WONKINESS DETECTED! disconnected:', socket.disconnected, 'wrong id', ocket.id != entry[0])
            }
            // if(Object.keys(this.connectedClients).length == 0) {
            //     // project.project.trimChanges(20)
            //      this.offloadProject(id) // find way to access this function
            // }
        })
        return wonkyKeys
    }
}

class ProjectWrapper {

    toJSON() {
        let ret = {
            project: this.project,
            id: this.id,
            scratchId: this.scratchId,
            projectJson: this.projectJson,
            jsonVersion: this.jsonVersion,
            linkedWith: this.linkedWith,
            owner: this.owner,
            sharedWith: this.sharedWith,
            chat: this.chat,
        }
        return ret;
    }

    static fromJSON(json) {
        let ret = new ProjectWrapper('&')
        Object.entries(json).forEach(entry => {
            if (entry[0] != 'project') {
                ret[entry[0]] = entry[1]
            }
        })
        ret.project = BlockliveProject.fromJSON(json.project)
        ret.session = new BlockliveSess(ret.project, ret.id)
        return ret
    }

    session
    project

    // blocklive id
    id
    // most recently saved json
    projectJson
    // json version
    jsonVersion = 0

    // // most up to date scratch project id
    scratchId
    // // index of next change i think
    // scratchVersion = 0
    linkedWith = [] // {scratchId, owner}

    owner
    sharedWith = []

    chat = []
    static defaultChat = { sender: 'blocklive', text: 'Welcome! Chat is public, monitored, and filtered. Report inappropriate things to @ilhp10. Drag the top of this chatbox to move it and drag the bottom right to resize it!' }

    constructor(owner, scratchId, projectJson, blId, title) {
        if (owner == '&') { return }
        this.id = blId
        this.owner = owner
        this.projectJson = projectJson
        this.scratchId = scratchId
        this.project = new BlockliveProject(title)
        this.session = new BlockliveSess(this.project, this.id)
        this.linkedWith.push({ scratchId, owner })
        this.chat.push(ProjectWrapper.defaultChat)
    }


    onChat(msg, socket) {
        this.chat.push(msg.msg)
        this.session.sendChangeFrom(socket, msg, true)
        this.trimChat(500)
    }
    getChat() {
        return this.chat
    }
    trimChat(n) {
        // bound n: 0 < n < total changes lenght
        if (!n) { n = 0 }
        n = Math.min(n, this.chat.length);
        this.chat = this.chat.slice(-n)
    }
    serverSendChat(message, from) {
        if (!from) { from = 'Blocklive' }
        let msg = {
            "meta": "chat",
            "msg": {
                "sender": from,
                "text": message,
            }
        }
        this.session.sendChangeFrom(null, msg, true)
    }

    trimChanges(n) { // defaults to trimming to json version
        if(!n) {n = this.project.version - this.jsonVersion}
        this.project.trimChanges(n)
    }

    // scratchSaved(id,version) {
    //     // dont replace scratch id if current version is already ahead
    //     if(version <= this.scratchVersion) {console.log('version too low. not recording. most recent version & id:',this.scratchVersion, this.scratchId);return}
    //     this.scratchId = id
    //     this.scratchVersion = version
    //     console.log('linkedWith length', this.linkedWith.length)
    //     this.linkedWith.find(proj=>proj.scratchId == id).version = version
    // }

    isSharedWith(username) {
        return username == this.owner || this.sharedWith.includes(username)
    }
    isSharedWithCaseless(username) {
        username=String(username).toLowerCase()
        let owner = String(this.owner).toLowerCase()
        let sharedWithLowercase=this.sharedWith.map(un=>String(un).toLowerCase())
        return username == owner || sharedWithLowercase.includes(username)
    }

    scratchSavedJSON(json, version) {
        if (version <= this.jsonVersion) { console.log('version too low. not recording. most recent version & id:', this.jsonVersion); return }
        this.projectJson = json
        this.jsonVersion = version
        this.trimChanges()
        // console.log('linkedWith length', this.linkedWith.length)
        // this.linkedWith.find(proj=>proj.scratchId == id).version = version
    }

    linkProject(scratchId, owner) {
        this.linkedWith.push({ scratchId, owner })
        // this.linkedWith.push({scratchId,owner,version})
    }

    // returns {scratchId, owner}
    getOwnersProject(owner) {
        return this.linkedWith.find(project => project.owner?.toLowerCase() == owner?.toLowerCase())
    }

    joinSession(socket, username) {
        if (socket.id in this.session.connectedClients) { return }
        let client = new BlockliveClient(socket, username)
        this.session.addClient(client)
        if (!this.project.lastUser) { this.project.lastUser = username }
    }
}

export default class SessionManager {

    toJSON() {
        let ret = {
            // scratchprojects:this.scratchprojects, //todo return only changed projects
            blocklive: this.blocklive,
            lastId: this.lastId,
        }
        return ret

    }
    static fromJSON(ob) {
        console.log(ob)
        let ret = new SessionManager();
        // if(ob.scratchprojects) { ret.scratchprojects = ob.scratchprojects; }
        if (ob.lastId) { ret.lastId = ob.lastId; }
        if (ob.blocklive) {
            Object.entries(ob.blocklive).forEach(entry => {
                ret.blocklive[entry[0]] = ProjectWrapper.fromJSON(entry[1]);
            })
        }

        return ret;
    }

    static inst;


    // map scratch project id's to info objects {owner, blId}
    // scratchprojects = {}
    // id -> ProjectWrapper
    blocklive = {}
    socketMap = {}

    lastId = 0

    constructor() {
        SessionManager.inst = this
    }

    // Deprecated
    offloadStaleProjects() {
            Object.entries(this.blocklive).forEach(entry => {
            let project = entry[1]
            let id = entry[0]
            if (Object.keys(project.session.connectedClients).length == 0) {
                project.project.trimChanges(20)
                this.offloadProject(id)
            }
        })
    }
    finalSaveAllProjects() {
        Object.entries(this.blocklive).forEach(entry => {
            let project = entry[1]
            let id = entry[0]
            project.trimChanges()
        })
        saveMapToFolder(this.blocklive, blocklivePath)
        this.blocklive = {}
    }
    async finalSaveAllProjectsAsync() {
        Object.entries(this.blocklive).forEach(entry => {
            let project = entry[1]
            let id = entry[0]
            project.trimChanges()
        })
        await saveMapToFolderAsync(this.blocklive, blocklivePath,false,true)
        this.blocklive = {}
    }
    // Deprecated
    async offloadStaleProjectsAsync() {
        for (let entry of Object.entries(this.blocklive)) {
            let project = entry[1]
            let id = entry[0]
            if (Object.keys(project.session.connectedClients).length == 0) {
                project.project.trimChanges(20)
                await this.offloadProjectAsync(id)
            }
        }
    }
    offloadProjectIfStale(id) {
        let project = this.blocklive[id];
        if (!project) { return }
        if (Object.keys(project.session.connectedClients).length == 0) {
            project.trimChanges()
            this.offloadProject(id)
        } else {
            this.renewOffloadTimeout(id)
        }
    }
    offloadProject(id) {
        try {
            console.log('offloading project ' + id)
            this.blocklive[id]?.trimChanges()
            let toSaveBlocklive = {}
            toSaveBlocklive[id] = this.blocklive[id]
            if (toSaveBlocklive[id]) { // only save it if there is actual data to save
                saveMapToFolder(toSaveBlocklive, blocklivePath);
            }
            delete this.blocklive[id]
        } catch (e) { console.error(e) }
    }
    async offloadProjectAsync(id) {
        try {
            console.log('offloading project ' + id)
            let toSaveBlocklive = {}
            toSaveBlocklive[id] = this.blocklive[id]
            if (toSaveBlocklive[id]) { // only save it if there is actual data to save
                await saveMapToFolderAsync(toSaveBlocklive, blocklivePath);
            }
            delete this.blocklive[id]
        } catch (e) { console.error(e) }
    }
    reloadProject(id) {
        id = sanitize(id + '')
        let filename = blocklivePath + path.sep + id;
        let d = null;
        if (!(id in this.blocklive) && fs.existsSync(filename)) {
            try {
                d = fs.openSync(filename)
                let file = fs.readFileSync(d)
                fs.closeSync(d)

                let json = JSON.parse(file)
                let project = ProjectWrapper.fromJSON(json);
                this.blocklive[id] = project
                console.log('reloaded blocklive ' + id)


            } catch (e) {
                // if(!id) {return}
                console.error("reloadProject: couldn't read project with id: " + id + ". err msg: ", e)

                // if(d) {
                //     try{fs.closeSync(d)}
                //     catch(e) {console.error(e)}
                // }
            }
        }
    }
    async reloadProjectAsync(id) {

        id = sanitize(id + '')
        if (!(id in this.blocklive)) {
            try {

                let file = await fsp.readFile(blocklivePath + path.sep + id)

                let json = JSON.parse(file)
                let project = ProjectWrapper.fromJSON(json);
                this.blocklive[id] = project
                console.log('reloaded blocklive ' + id)
            } catch (e) {
                // if(!id) {return}
                console.error("reloadProject: couldn't read project with id: " + id + ". err msg: ", e)
            }
        }
    }

    linkProject(id, scratchId, owner, version) {
        let project = this.getProject(id)
        if (!project) { return }
        project.linkProject(scratchId, owner, version)
        // this.scratchprojects[scratchId] = {owner,blId:id}
        this.makeScratchProjectEntry(scratchId, owner, id)
    }

    // constructor(owner,scratchId,json,blId,title) {
    newProject(owner, scratchId, json, title) {
        if (this.doesScratchProjectEntryExist(scratchId)) { return this.getProject(this.getScratchProjectEntry(scratchId).blId) }
        let id = String(this.getNextId())
        let project = new ProjectWrapper(owner, scratchId, json, id, title)
        this.blocklive[id] = project
        this.makeScratchProjectEntry(scratchId, owner, id)
        // this.scratchprojects[scratchId] = {owner,blId:id}

        return project
    }

    join(socket, id, username,) {
        let project = this.getProject(id)
        if (!project) { return }
        project.joinSession(socket, username)
        if (!(socket.id in this.socketMap)) {
            this.socketMap[socket.id] = { username: username, projects: [] }
        }
        if (this.socketMap[socket.id].projects.indexOf(project.id) == -1) {
            this.socketMap[socket.id].projects.push(project.id)
        }
        console.log(username + ' joined | blId: ' + id + ', scratchId: ' + project.scratchId)
    }
    leave(socket, id, voidMap) {
        let project = this.getProject(id)
        if (!project) { return }
        let username = project.session.removeClient(socket.id)
        if (socket.id in this.socketMap && !voidMap) {
            let array = this.socketMap[socket.id].projects

            const index = array.indexOf(id);
            if (index > -1) {
                array.splice(index, 1);
            }
        }
        if (Object.keys(project.session.connectedClients).length == 0) {
            project.trimChanges()
            this.offloadProject(id)
        }
        console.log(username + ' LEFT | blId: ' + id + ', scratchId: ' + project.scratchId)
    }

    disconnectSocket(socket) {
        if (!(socket.id in this.socketMap)) { return }
        this.socketMap[socket.id].projects.forEach(projectId => { this.leave(socket, projectId, true) })
        delete this.socketMap[socket.id]
    }

    projectChange(blId, data, socket) {
        this.getProject(blId)?.session.onProjectChange(socket, data.msg)
    }

    getVersion(blId) {
        return this.getProject(blId)?.project.version
    }

    getNextId() {
        this.lastId++;
        this.tryWriteLastId()
        return this.lastId
    }

    tryWriteLastId() {
        try {
            fs.writeFile(lastIdPath, this.lastId.toString(), () => { })
        } catch (e) { console.error(e) }
    }

    // todo checking
    attachScratchProject(scratchId, owner, blockliveId) {
        this.makeScratchProjectEntry(scratchId, owner, blockliveId)
        // this.scratchprojects[scratchId] = {owner,blId:blockliveId}
    }

    offloadTimeoutIds = {}
    renewOffloadTimeout(blId) {
        // clear previous timeout
        clearTimeout(this.offloadTimeoutIds[blId]);
        delete this.offloadTimeoutIds[blId]
        // set new timeout
        let timeout = setTimeout(() => { this.offloadProjectIfStale(blId) }, OFFLOAD_TIMEOUT_MILLIS)
        this.offloadTimeoutIds[blId] = timeout

    }

    getProject(blId) {
        this.renewOffloadTimeout(blId)
        this.reloadProject(blId)
        return this.blocklive[blId]
    }
    async getProjectAsync(blId) { // untested attempt to avoid too many files open in node version 17.9.1
        this.renewOffloadTimeout(blId)
        await this.reloadProject(blId)
        return this.blocklive[blId]
    }
    shareProject(id, user, pk) {
        console.log(`sessMngr: sharing ${id} with ${user} (usrId ${pk})`)
        let project = this.getProject(id)
        if (!project) { return }
        project.sharedWith.push(user)
    }
    unshareProject(id, user) {
        console.log(`sessMngr: unsharing ${id} with ${user}`)
        let project = this.getProject(id)
        if (!project) { return }

        project.linkedWith.filter(proj => (proj.owner.toLowerCase() == user.toLowerCase())).forEach(proj => {
            project.linkedWith.splice(project.linkedWith.indexOf(proj))
            this.deleteScratchProjectEntry(proj.scratchId)
            // delete this.scratchprojects[proj.scratchId]
            // let projectPatch = scratchprojectsPath + path.sep + sanitize(proj.scratchId + '');
            // if(fs.existsSync(projectPatch)) {
            //     try{ fs.rmSync(projectPatch) } catch(e){console.error(e)} 
            // }
        })

        if (project.owner.toLowerCase() == user.toLowerCase()) {
            project.owner = project.sharedWith[0] ? project.sharedWith[0] : '';
        }

        let userIndex = project.sharedWith.indexOf(user)
        if (userIndex != -1) {
            project.sharedWith.splice(userIndex, 1)
        }

        // delete the project file if no-one owns it
        if (project.onwer == '') {
            this.deleteProjectFile(project.id)
        }
        // TODO: Handle what-if their project is the inpoint?
    }

    deleteProjectFile(id) {
        console.log(`deleting 🚮 project file with id ${id}`)

        this.offloadProject(id)
        let projectPath = blocklivePath + path.sep + sanitize(id)
        if (fs.existsSync(projectPath)) {
            try { fs.rmSync(projectPath) } catch (e) { console.error('error when deleting project file after unsharing with everyone', e) }
        }
    }

    getScratchToBLProject(scratchId) {
        let blId = this.getScratchProjectEntry(scratchId)?.blId
        if (!blId) { return null }
        return this.getProject(blId)
    }

    getScratchProjectEntry(scratchId) {
        try {
            if (!scratchId) { return }
            let scratchIdFilename = sanitize(scratchId + '');
            let filename = scratchprojectsPath + path.sep + scratchIdFilename;
            if (!fs.existsSync(filename)) { return null }
            let file = fs.readFileSync(filename)
            let entry = JSON.parse(file)
            return entry;
        } catch (e) { console.error(e) }
    }
    makeScratchProjectEntry(scratchId, owner, blId) {
        try {
            if (!scratchId) { return }
            let scratchIdFilename = sanitize(scratchId + '');
            let filename = scratchprojectsPath + path.sep + scratchIdFilename;
            let entry = { owner, blId }
            let fileData = JSON.stringify(entry)
            fs.writeFileSync(filename, fileData)
        } catch (e) { console.error(e) }
    }
    doesScratchProjectEntryExist(scratchId) {
        if (!scratchId) { return false }
        let scratchIdFilename = sanitize(scratchId + '');
        let filename = scratchprojectsPath + path.sep + scratchIdFilename;
        return fs.existsSync(filename)
    }
    deleteScratchProjectEntry(scratchId) {
        console.log(`DELETING scratch project entry ${scratchId}`)
        if (!scratchId) { return }
        if (!this.doesScratchProjectEntryExist(scratchId)) { return }
        let scratchIdFilename = sanitize(scratchId + '');
        let filename = scratchprojectsPath + path.sep + scratchIdFilename;
        fs.rmSync(filename);
    }

    // if 'from' is null, defaults to 'Blocklive'
    broadcastMessageToAllActiveProjects(message, from) {
        Object.entries(this.blocklive).forEach(entry => {
            let id = entry[0];
            let project = entry[1];

            try {
                if (Object.keys(project.session.connectedClients).length > 0) {
                    project.serverSendChat(message, from)
                }
            } catch (e) { console.error(e) }
        })
    }

    getStats() {
        let set1 = new Set();
        let set2 = new Set();
        let stats = {
            active2HrCollabing:0,
            active24HrCollabing:0,
            active1weekCollabing:0,
            active30dCollabing:0,
            active24HrRealtime:0,
            active1weekRealtime:0,
            active30dRealtime:0,
            active24Hr:0,
            active1week:0,
            active30d:0,
            popup24hr:0,
            popup1week:0,
            popup1month:0,
            popupUnique24hr:0,
            popupUnique1week:0,
            totalActiveProjects: 0,
            totalProjectsMoreThan1Editor: 0,
            usersActiveCount: 0,
            usersActiveMoreThan1EditorCount: 0,
            usersActive: [],
            usersActiveMoreThan1Editor: [],
            projectsActiveSingleEditor:[],
            projectsActiveMoreThan1Editor:[],
            maxInOneProject: {
                id: 0,
                num: 0,
            }
        }
        Object.entries(this.blocklive).forEach(entry => {
            let id = entry[0];
            let project = entry[1];

            let connectedUsernames = project.session.getConnectedUsernames();
            try {
                if(connectedUsernames.length==1) {
                    stats.projectsActiveSingleEditor.push(project.scratchId)
                }
                if (connectedUsernames.length > 0) {
                    stats.totalActiveProjects++;
                    project.session.getConnectedUsernames().forEach(set1.add, set1)
                }
                if (connectedUsernames.length > 1) {
                    stats.totalProjectsMoreThan1Editor++;
                    connectedUsernames.forEach(set2.add, set2)
                    stats.usersActiveMoreThan1Editor.push(connectedUsernames)
                    stats.projectsActiveMoreThan1Editor.push(project.scratchId)
                }
                if (connectedUsernames.length > stats.maxInOneProject.num) {
                    stats.maxInOneProject.num = Object.keys(project.session.connectedClients).length;
                    stats.maxInOneProject.id = project.id;
                }
            } catch (e) { console.error(e) }
        })
        stats.usersActive = Array.from(set1);
        let oldUsersActiveMoreThan1Editor = Array.from(set2);
        stats.usersActiveCount = stats.usersActive.length
        stats.usersActiveMoreThan1EditorCount = oldUsersActiveMoreThan1Editor.length

        stats.active2HrCollabing = countRecentShared(1/24*2);
        stats.active24HrCollabing = countRecentShared(1);
        stats.active1weekCollabing = countRecentShared(7);
        stats.active30dCollabing = countRecentShared(30);
        stats.active24HrRealtime = countRecentRealtime(1);
        stats.active1weekRealtime = countRecentRealtime(7);
        stats.active30dRealtime = countRecentRealtime(30);
        stats.active24Hr = countRecent(1);
        stats.active1week = countRecent(7);
        stats.active30d = countRecent(30);
        stats.popup24hr = countPopup(1);
        stats.popup1week = countPopup(7);
        stats.popup1month = countPopup(30);
        stats.popupUnique24hr = countUniquePopup(1)
        stats.popupUnique1week = countUniquePopup(7)

        stats.auth = getAuthStats();
        stats.auth.numWithCreds = numWithCreds;
        stats.auth.numWithoutCreds = numWithoutCreds;
        return stats;
    }

    canUserAccessProject(username,blId) {
        let project = this.getProject(blId)
        if(!project) {return true;}
        return project.isSharedWithCaseless(username)
    }
}