import 'dotenv/config';

// be mindful of:
// numbers being passed as strings

///////////
import express from 'express';
const app = express();
import cors from 'cors';
app.use(cors({origin:'*'}));
app.use(express.json({ limit: '5MB' }));
import basicAuth from 'express-basic-auth';
import http from 'http';

let httpServer = http.createServer(app);

import {Server} from 'socket.io';
const ioHttp = new Server(httpServer, {
    cors:{origin:'*'},
    maxHttpBufferSize:2e7,
});

import SessionManager from './utils/sessionManager.js';
import UserManager from './utils/userManager.js';
import sanitize from 'sanitize-filename';

export let isFinalSaving = false;

import * as fileStorageUtils from './utils/fileStorage.js';
import { installCleaningJob } from './utils/removeOldProjects.js';
import { countRecentShared, recordPopup } from './utils/recentUsers.js';
import {setPaths, authenticate, fullAuthenticate, freePassesPath, freePasses} from './utils/scratch-auth.js';
import initSockets from './WebSockets.js';

const restartMessage = 'The Livescratch server is restarting. You will lose connection for a few seconds.';

function sleep(millis) {
    return new Promise(res=>setTimeout(res,millis));
}

// Load session and user manager objects


/// LOAD SESSION MANAGER
let sessionsObj = fileStorageUtils.loadMapFromFolderRecursive('storage');

var sessionManager = SessionManager.fromJSON(sessionsObj);

/// LOAD USER MANAGER
var userManager = new UserManager();
setPaths(app,userManager,sessionManager);

// let id = sessionManager.newProject('tester124','644532638').id
// sessionManager.linkProject(id,'602888445','ilhp10',5)
// userManager.befriend('ilhp10','tester124')
// userManager.befriend('tester124','ilhp10')
// console.log(JSON.stringify(sessionManager))

fileStorageUtils.saveMapToFolder(sessionManager.livescratch,fileStorageUtils.livescratchPath);

fileStorageUtils.saveLoop(sessionManager);

async function finalSave(sessionManager) {
    try{
        if(isFinalSaving) {return;} // Exit early if another save is in progress to avoid duplication
        console.log('sending message "' + restartMessage + '"');
        sessionManager.broadcastMessageToAllActiveProjects(restartMessage);
        await sleep(1000 * 2);
        isFinalSaving = true;
        console.log('final saving...');
        fs.writeFileSync(fileStorageUtils.lastIdPath,(sessionManager.lastId).toString());
        fs.writeFileSync(freePassesPath,JSON.stringify(freePasses));
        await sessionManager.finalSaveAllProjects(); // Save all active project data to disk. This operation also automatically "offloads" them (frees memory).
        saveMapToFolder(userManager.users,fileStorageUtils.usersPath);
        await saveRecent();
        process.exit();
    } catch (e) {
        await sleep(1000 * 10); // If an error occurs, wait 10 seconds before allowing another save attempt
        isFinalSaving = false;
    }
}

setTimeout(()=>installCleaningJob(sessionManager,userManager),1000 * 10);

new initSockets(ioHttp, sessionManager, userManager);
// todo: save info & credits here
app.post('/newProject/:scratchId/:owner',(req,res)=>{
    if(!authenticate(req.params.owner,req.headers.authorization)) {res.send({noauth:true}); return;}
    if( !req.params.scratchId || ( sanitize(req.params.scratchId.toString()) == '' ) ) {res.send({err:'invalid scratch id'}); return;}
    let project = sessionManager.getScratchToLSProject(req.params.scratchId);
    let json = req.body;
    if(!project) {
        console.log('creating new project from scratch project: ' + req.params.scratchId + ' by ' + req.params.owner + ' titled: ' + req.query.title);
        project = sessionManager.newProject(req.params.owner,req.params.scratchId,json,req.query.title);
        userManager.newProject(req.params.owner,project.id);
    }
    res.send({id:project.id});
});

app.get('/lsId/:scratchId/:uname',(req,res)=>{
    let lsId = sessionManager.getScratchProjectEntry(req.params.scratchId)?.blId;
    if(!lsId) {res.send(lsId); return;}
    let project = sessionManager.getProject(lsId);
    if(!project) { // if the project doesnt exist, dont send it!!!
        sessionManager.deleteScratchProjectEntry(req.params.scratchId);
        res.send(null); 
        return;
    }
    let hasAccess = fullAuthenticate(req.params.uname,req.headers.authorization,lsId);
    // let hasAccess = project.isSharedWithCaseless(req.params.uname)

    res.send(hasAccess ? lsId : null);
});
app.get('/scratchIdInfo/:scratchId',(req,res)=>{
    if (sessionManager.doesScratchProjectEntryExist(req.params.scratchId)) {
        res.send(sessionManager.getScratchProjectEntry(req.params.scratchId));
    } else {
        res.send({err:('could not find livescratch project associated with scratch project id: ' + req.params.scratchId)});
    }
});
// meechapooch: "todo: sync info and credits with this endpoint as well?" Waakul: Na hail naw, setting idea unlocked!
app.get('/projectTitle/:id',(req,res)=>{
    if(!fullAuthenticate(req.headers.uname,req.headers.authorization,req.params.id)) {res.send({noauth:true}); return;}

    let project = sessionManager.getProject(req.params.id);
    if(!project) {
        res.send({err:'could not find project with livescratch id: ' + req.params.id});
    } else {
        res.send({title:project.project.title});
    }
});
app.post('/projectSavedJSON/:lsId/:version',(req,res)=>{
    if(!fullAuthenticate(req.headers.uname,req.headers.authorization,req.params.lsId)) {res.send({noauth:true}); return;}

    let json = req.body;
    let project = sessionManager.getProject(req.params.lsId);
    if(!project) {
        console.log('Could not find project: '+req.params.lsId);
        res.send({ err: 'Couldn\'t find the specified project!' });
        return;
    }
    project.scratchSavedJSON(json,parseFloat(req.params.version));
    res.send({ success: 'Successfully saved the project!' });
});
app.get('/projectJSON/:lsId',(req,res)=>{
    if(!fullAuthenticate(req.query.username,req.headers.authorization,req.params.lsId)) {res.send({noauth:true}); return;}

    let lsId = req.params.lsId;
    let project = sessionManager.getProject(lsId);
    if(!project) {res.sendStatus(404); return;}
    let json = project.projectJson;
    let version = project.jsonVersion;
    res.send({json,version});
    return;
});

app.use('/html',express.static('static'));
app.get('/changesSince/:id/:version',(req,res)=>{
    if(!fullAuthenticate(req.headers.uname,req.headers.authorization,req.params.id)) {res.send({noauth:true}); return;}

    let project = sessionManager.getProject(req.params.id);
    if(!project) {res.send([]);}
    else {

        let oldestChange = project.project.getIndexZeroVersion();
        let clientVersion = req.params.version;
        let jsonVersion = project.jsonVersion;
        let forceReload = clientVersion<oldestChange-1 && jsonVersion>=oldestChange-1;
        if(clientVersion<oldestChange-1 && jsonVersion<oldestChange-1) {console.error('client version too old AND json version too old. id,jsonVersion,clientVersion,indexZeroVersion',project.id,jsonVersion,clientVersion,oldestChange);}

        let changes = project.project.getChangesSinceVersion(parseFloat(req.params.version));
        if(forceReload) {
            changes=ListToObj(changes);
            changes.forceReload=true;
        }

        res.send(changes);
    }
});
function ListToObj(list) {
    let output={length:list.length};
    for(let i=0; i<list.length; i++) {
        output[i]=list[i];
    }
    return output;
}

app.get('/chat/:id',(req,res)=>{
    if(!fullAuthenticate(req.headers.uname,req.headers.authorization,req.params.id)) {res.send({noauth:true}); return;}
    let project = sessionManager.getProject(req.params.id);
    if(!project) {res.send([]);}
    else {
        res.send(project.getChat());
    }
});

app.use('/ban', basicAuth({
    users: JSON.parse(process.env.ADMIN_USER),
    challenge: true,
}));
app.put('/ban/:username', (req,res) => {
    fileStorageUtils.ban(req.params.username)
        .then(() => {
            res.send({ success: 'Successfully banned!' });
        })
        .catch((err) => {
            res.send({ err: err });
        });
});

app.use('/unban', basicAuth({
    users: JSON.parse(process.env.ADMIN_USER),
    challenge: true,
}));
app.put('/unban/:username', (req,res) => {
    fileStorageUtils.unban(req.params.username)
        .then(() => {
            res.send({ success: 'Successfully unbanned!' });
        })
        .catch((err) => {
            res.send({ err: err });
        });
});

app.use('/banned', basicAuth({
    users: JSON.parse(process.env.ADMIN_USER),
    challenge: true,
}));
app.get('/banned', (req,res) => {
    fileStorageUtils.getBanned()
        .then((bannedList) => {
            res.send(bannedList);
        })
        .catch((err) => {
            res.send({ err: err });
        });
});

let cachedStats = null;
let cachedStatsTime = 0;
let cachedStatsLifetimeMillis = 1000;
app.use('/stats',basicAuth({
    users: JSON.parse(process.env.ADMIN_USER),
    challenge: true,
}));
app.get('/stats',(req,res)=>{
    if(Date.now() - cachedStatsTime > cachedStatsLifetimeMillis) {
        cachedStats = sessionManager.getStats();
        cachedStats.cachedAt = new Date();
        cachedStatsTime = Date.now();
    } 
    res.send(cachedStats);
});

app.get('/dau/:days',(req,res)=>{
    res.send(String(countRecentShared(parseFloat(req.params.days))));
});
app.put('/linkScratch/:scratchId/:lsId/:owner',(req,res)=>{
    if(!fullAuthenticate(req.params.owner,req.headers.authorization,req.params.lsId)) {res.send({noauth:true}); return;}

    console.log('linking:',req.params);
    sessionManager.linkProject(req.params.lsId,req.params.scratchId,req.params.owner,0);
    res.send({ success: 'Successfully linked!' });
});
app.get('/userExists/:username',(req,res)=>{
    res.send(userManager.userExists(req.params.username) && !userManager.getUser(req.params.username).privateMe);
});
app.put('/privateMe/:username/:private',(req,res)=>{
    req.params.username = sanitize(req.params.username);
    if(!authenticate(req.params.username,req.headers.authorization)) {res.send({noauth:true}); return;}
    let user = userManager.getUser(req.params.username);
    user.privateMe = req.params.private == 'true';
    res.status(200).end();
});
app.get('/privateMe/:username',(req,res)=>{
    req.params.username = sanitize(req.params.username);
    if(!authenticate(req.params.username,req.headers.authorization)) {res.send({noauth:true}); return;}
    let user = userManager.getUser(req.params.username);
    res.send(user.privateMe);
});
app.get('/userRedirect/:scratchId/:username',(req,res)=>{

    let project = sessionManager.getScratchToLSProject(req.params.scratchId);

    if(!fullAuthenticate(req.params.username,req.headers.authorization,project?.id)) {res.send({noauth:true,goto:'none'}); return;}

    if(!project) {res.send({goto:'none'}); return;}
     
    let ownedProject = project.getOwnersProject(req.params.username);
    if(!!ownedProject) {
        res.send({goto:ownedProject.scratchId});
    } else {
        res.send({goto:'new', lsId:project.id});
    }
});

app.get('/active/:lsId',(req,res)=>{
    if(!fullAuthenticate(req.headers.uname,req.headers.authorization,req.params.lsId)) {res.send({noauth:true}); return;}

    let usernames = sessionManager.getProject(req.params.lsId)?.session.getConnectedUsernames();
    let clients = sessionManager.getProject(req.params.lsId)?.session.getConnectedUsersClients();
    if(usernames) {
        res.send(usernames.map(name=>{
            let user = userManager.getUser(name);
            return {username:user.username,pk:user.pk,cursor:clients[name].cursor};
        }));
    } else {
        res.send({err:'could not get users for project with id: ' + req.params.lsId});
    }
});

app.get('/',(req,res)=>{
    res.send('LiveScratch API');
});

app.post('/friends/:user/:friend',(req,res)=>{
    if(!authenticate(req.params.user,req.headers.authorization)) {res.send({noauth:true}); return;}

    if (!userManager.userExists(req.params.friend)) {
        res.sendStatus(404);
        return;
    }

    userManager.befriend(req.params.user,req.params.friend);
    res.send({ success: 'Successfully friended!' });
});
app.delete('/friends/:user/:friend',(req,res)=>{
    if(!authenticate(req.params.user,req.headers.authorization)) {res.send({noauth:true}); return;}

    userManager.unbefriend(req.params.user,req.params.friend);
    res.send({ success: 'Succesfully unfriended!' });

});
app.get('/friends/:user',(req,res)=>{
    recordPopup(req.params.user);
    if(!authenticate(req.params.user,req.headers.authorization)) {res.send({noauth:true}); return;}

    res.send(userManager.getUser(req.params.user)?.friends);
});

// get list of livescratch id's shared TO user (from another user)
app.get('/userProjects/:user',(req,res)=>{
    if(!authenticate(req.params.user,req.headers.authorization)) {res.send({noauth:true}); return;}

    res.send(userManager.getShared(req.params.user));
});
// get list of scratch project info shared with user for displaying in mystuff
app.get('/userProjectsScratch/:user',(req,res)=>{
    if(!authenticate(req.params.user,req.headers.authorization)) {res.send({noauth:true}); return;}

    let livescratchIds = userManager.getAllProjects(req.params.user);
    let projectsList = livescratchIds.map(id=>{
        let projectObj = {};
        let project = sessionManager.getProject(id);
        if(!project) {return null;}
        projectObj.scratchId = project.getOwnersProject(req.params.user)?.scratchId;
        if(!projectObj.scratchId) {projectObj.scratchId = project.scratchId;}
        projectObj.blId = project.id;
        projectObj.title = project.project.title;
        projectObj.lastTime = project.project.lastTime;
        projectObj.lastUser = project.project.lastUser;
        projectObj.online = project.session.getConnectedUsernames();

        return projectObj;
    }).filter(Boolean); // filter out non-existant projects // TODO: automatically delete dead pointers like this
    res.send(projectsList);
});

app.put('/leaveScratchId/:scratchId/:username',(req,res)=>{
    let project = sessionManager.getScratchToLSProject(req.params.scratchId);

    if(!fullAuthenticate(req.params.username, req.headers.authorization, project, false)) {res.send({noauth:true}); return;}
    userManager.unShare(req.params.username, project.id);
    sessionManager.unshareProject(project.id, req.params.username);
    res.send({ success: 'User succesfully removed!'});
});
app.put('/leaveLSId/:lsId/:username',(req,res)=>{
    if(!authenticate(req.params.username,req.headers.authorization)) {res.send({noauth:true}); return;}
    userManager.unShare(req.params.username, req.params.lsId);
    sessionManager.unshareProject(req.params.lsId, req.params.username);
    res.send({ success: 'User succesfully removed!'});
});
app.get('/verify/test',(req,res)=>{
    res.send({verified:authenticate(req.query.username,req.headers.authorization)});
});


app.get('/share/:id',(req,res)=>{
    if(!fullAuthenticate(req.headers.uname,req.headers.authorization,req.params.id)) {res.send({noauth:true}); return;} // todo fix in extension

    let project = sessionManager.getProject(req.params.id);
    let list = project?.sharedWith;
    if(!list) {res.send({ err: 'No shared list found for the specified project.' }); return;}
    list = list.map(name=>({username:name,pk:userManager.getUser(name).pk})); // Add user ids for profile pics
    res.send(list ? [{username:project.owner,pk:userManager.getUser(project.owner).pk}].concat(list) : {err:'could not find livescratch project: ' + req.params.id} );
});
app.put('/share/:id/:to/:from',(req,res)=>{
    if(!fullAuthenticate(req.params.from,req.headers.authorization,req.params.id)) {res.send({noauth:true}); return;}

    if(sessionManager.getProject(req.params.id)?.owner == req.params.to) {
        res.send({ err: 'Cannot share the project with the owner.' });
        return;
    }

    if (!userManager.userExists(req.params.to)) {
        res.sendStatus(404);
        return;
    }

    sessionManager.shareProject(req.params.id, req.params.to, req.query.pk);
    userManager.getUser(req.params.to).pk = req.query.pk;
    userManager.share(req.params.to, req.params.id, req.params.from);
    res.send({ success: 'Project successfully shared.' });
});
app.put('/unshare/:id/:to/',(req,res)=>{
    if(!fullAuthenticate(req.headers.uname,req.headers.authorization,req.params.id)) {res.send({noauth:true}); return;}

    if(sessionManager.getProject(req.params.id)?.owner == req.params.to) {
        res.send({ err: 'Cannot unshare the project with the owner.' });
        return;
    }
    sessionManager.unshareProject(req.params.id, req.params.to);
    userManager.unShare(req.params.to, req.params.id);
    res.send({ success: 'Project successfully unshared.' });
});

const port = process.env.PORT;
httpServer.listen(port,'0.0.0.0');
console.log('listening http on port ' + port);


// initial handshake:
// client says hi, sends username & creds, sends project id 
// server generates id, sends id
// server sends JSON or scratchId
// client loads, sends when isReady
// connection success!! commense the chitter chatter!






// copied from https://stackoverflow.com/questions/14031763/doing-a-cleanup-action-just-before-node-js-exits

process.stdin.resume();//so the program will not close instantly

async function exitHandler(options, exitCode) {
    if (options.cleanup) console.log('clean');
    if (exitCode || exitCode === 0) console.log(exitCode);

    if(options.exit) {finalSave(sessionManager);}

}

//do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, {exit:true}));
process.on('SIGUSR2', exitHandler.bind(null, {exit:true}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));