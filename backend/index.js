// be mindful of:
// numbers being passed as strings
export const bypassUserAuth = true // until everyone gets the new client version

///////////
import express from 'express'
const app = express();
import cors from 'cors'
app.use(cors({origin:'*'}))
app.use(express.json({ limit: '5MB' }))
import fsp from 'fs/promises'
import basicAuth from 'express-basic-auth'
import os from 'os'
import path from 'path';
import https from 'https'
import http from 'http'

let httpServer = http.createServer(app);
let httpsServer = null

if(!['darwin','win32'].includes(os.platform())) {
     let homedir = '/home/opc'
     let privateKey = fs.readFileSync( homedir + path.sep + 'letsencrypt/live/spore.us.to/privkey.pem' );
     let certificate = fs.readFileSync( homedir + path.sep + 'letsencrypt/live/spore.us.to/fullchain.pem' );
     httpsServer = https.createServer({
          key: privateKey,
          cert: certificate,
     },app); 
}
////////////

////////////
// copied from https://stackoverflow.com/questions/11804202/how-do-i-setup-a-ssl-certificate-for-an-express-js-server

/////////

import {Server} from 'socket.io'
let ioHttps = null
if(httpsServer) {
     ioHttps = new Server(httpsServer, {
          cors:{origin:'*'},
          maxHttpBufferSize:2e7
     });
}
const ioHttp = new Server(httpServer, {
     cors:{origin:'*'},
     maxHttpBufferSize:2e7
});

import SessionManager from './sessionManager.js'
import UserManager from './userManager.js'
import fs from 'fs'
import { ppid } from 'process';
import sanitize from 'sanitize-filename';

import { blocklivePath, lastIdPath, loadMapFromFolder, saveMapToFolder, saveMapToFolderAsync, scratchprojectsPath, usersPath} from './filesave.js'
import { Filter } from './profanity-filter.js';
import { postText } from './discord-webhook.js';
import { installCleaningJob } from './removeOldProjects.js';
import { addRecent, countRecentShared, recordPopup, saveRecent } from './recentUsers.js';
import { admin, adminUser } from './secrets/secrets.js';
import {setPaths, authenticate, freePassesPath, freePasses} from './scratch-auth.js';


const restartMessage = 'The Blocklive server is restarting. You will lose connection for a few seconds.'
// Load session and user manager objects


/// LOAD SESSION MANAGER
// todo: build single recursive directory to object parsing function
let sessionsObj = {}
// sessionsObj.blocklive = loadMapFromFolder('storage/sessions/blocklive');
sessionsObj.blocklive = {};
// sessionsObj.scratchprojects = loadMapFromFolder('storage/sessions/scratchprojects');
sessionsObj.lastId = fs.existsSync('storage/sessions/lastId') ? parseInt(fs.readFileSync('storage/sessions/lastId').toString()) : 0
let banned = fs.existsSync('storage/banned') ? fs.readFileSync('storage/banned').toString().split('\n') : []
console.log(sessionsObj)


// sessionsObj = JSON.parse(fs.readFileSync('storage/sessions.json')) // load sessions from file sessions.json

var sessionManager = SessionManager.fromJSON(sessionsObj)

/// LOAD USER MANAGER
// var userManager = UserManager.fromJSON({users:loadMapFromFolder('storage/users')}) // load from users folder
// var userManager = UserManager.fromJSON({users:JSON.parse(fs.readFileSync('storage/users.json'))}) // load from file users.json
var userManager = new UserManager()
setPaths(app,userManager,sessionManager)

// share projects from sessions db in users db
// Object.values(sessionManager.blocklive).forEach(proj=>{
//      let owner = proj.owner;
//      let sharedWith = proj.sharedWith;
//      sharedWith.forEach(person=>{
//           userManager.share(person,proj.id, owner)
//      })
// })


// let id = sessionManager.newProject('tester124','644532638').id
// sessionManager.linkProject(id,'602888445','ilhp10',5)
// userManager.befriend('ilhp10','tester124')
// userManager.befriend('tester124','ilhp10')
// console.log(JSON.stringify(sessionManager))

function sleep(millis) {
     return new Promise(res=>setTimeout(res,millis))
}
async function saveAsync() {
     if(isFinalSaving) {return} // dont final save twice

     console.log('saving now...')
     await sleep(10); // in case there is an error that nans lastid out
     await fsp.writeFile(lastIdPath,(sessionManager.lastId).toString());
     await fsp.writeFile(freePassesPath,JSON.stringify(freePasses))

     // DONT SAVE BLOCKLIVE PROJECTS BECAUSE ITS TOO TAXING AND IT HAPPENS ANYWAYS ON OFFLOAD
     // console.log('writing blocklives')
     // await saveMapToFolderAsync(sessionManager.blocklive,blocklivePath,true);
     // console.log('DONE writing blocklives')
     // await saveMapToFolderAsync(userManager.users,usersPath);
     await saveRecent();
}
let isFinalSaving = false;
async function finalSave() {
     try{
          if(isFinalSaving) {return} // dont final save twice
          console.log('sending message "' + restartMessage + '"')
          sessionManager.broadcastMessageToAllActiveProjects(restartMessage);
          await sleep(1000 * 2);
          isFinalSaving = true
          console.log('final saving...')
          fs.writeFileSync(lastIdPath,(sessionManager.lastId).toString());
          fs.writeFileSync(freePassesPath,JSON.stringify(freePasses))
          await sessionManager.finalSaveAllProjects(); // now they automatically offload
          saveMapToFolder(userManager.users,usersPath);
          await saveRecent();
          process.exit()
     } catch (e) {
          await sleep(1000 * 10); // wait ten seconds before trying to quit again
          isFinalSaving = false;
     }
}
saveMapToFolder(sessionManager.blocklive,blocklivePath)

async function saveLoop() {
     while(true) {
          try{ await saveAsync(); } 
          catch (e) { console.error(e) }
          await sleep(30 * 1000)
     }
}
saveLoop()
setTimeout(()=>installCleaningJob(sessionManager,userManager),1000 * 10)

const filter = new Filter()
filter.loadDefault()

let messageHandlers = {
     'joinSession':(data,client)=>{
          if(!fullAuthenticate(data.username,data.token,data.id)) {client.send({noauth:true}); return;}

          sessionManager.join(client,data.id,data.username)
          if(data.pk) { userManager.getUser(data.username).pk = data.pk }
     },'joinSessions':(data,client)=>{
          if(!fullAuthenticate(data.username,data.token,data.id)) {client.send({noauth:true}); return;}

          data.ids.forEach(id=>{sessionManager.join(client,id,data.username)})
          if(data.pk) { userManager.getUser(data.username).pk = data.pk }
     },
     'leaveSession':(data,client)=>{
          sessionManager.leave(client,data.id)
     },
     // 'shareWith':(data,client)=>{
     //      if(!fullAuthenticate(data.username,data.token,data.id)) {client.send({noauth:true}); return;}

     //      sessionManager.shareProject(data.id,data.user,data.pk)
     // },
     'projectChange':(data,client,callback)=>{
          if(!fullAuthenticate(data.username,data.token,data.blId)) {client.send({noauth:true}); return;}

          sessionManager.projectChange(data.blId,data,client)
          callback(sessionManager.getVersion(data.blId))
     },
     // 'getChanges':(data,client)=>{
     //      if(!fullAuthenticate(data.username,data.token,data.id)) {client.send({noauth:true}); return;}

     //      let project = sessionManager.getProject(data.id)
     //      if(!project) {return}
         
     //      let oldestChange = project.project.getIndexZeroVersion();
     //      let clientVersion = data.version;
     //      let jsonVersion = project.jsonVersion;
     //      let forceReload = clientVersion<oldestChange-1 && jsonVersion>=oldestChange-1;


     //      let changes = project?.project.getChangesSinceVersion(data.version)
     //      client.send({type:'projectChanges',changes,forceReload,projectId:data.id,currentVersion:project.project.version})
     // },
     'setTitle':(data,client)=>{
          if(!fullAuthenticate(data.username,data.token,data.blId)) {client.send({noauth:true}); return;}

          let project = sessionManager.getProject(data.blId)
          if(!project) {return}
          project.project.title = data.msg.title
          project.session.sendChangeFrom(client,data.msg,true)
     },
     'setCursor':(data,client)=>{ // doesnt need to be authenticated because relies on pre-authenticated join action
          let project = sessionManager.getProject(data.blId)
          if(!project) {return}
          let cursor = project.session.getClientFromSocket(client)?.cursor
          if(!cursor) {return}
          Object.entries(data.cursor).forEach(e=>{
               if(e[0] in cursor) { cursor[e[0]] = e[1] }
          })
     },
     'chat':(data,client)=>{
          const BROADCAST_KEYWORD = 'toall '

          delete data.msg.msg.linkify
          let text = String(data.msg.msg.text)
          let sender = data.msg.msg.sender
          let project = sessionManager.getProject(data.blId)

          if(!fullAuthenticate(sender,data.token,data.blId,true)) {client.send({noauth:true}); return;}
          if(admin.includes(sender?.toLowerCase()) && text.startsWith(BROADCAST_KEYWORD)) {
               let broadcast=text.slice(BROADCAST_KEYWORD.length)
               console.log(`broadcasting message to all users: "${broadcast}" [${sender}]`)
               postText(`broadcasting message to all users: "${broadcast}" [${sender}]`)
               sessionManager.broadcastMessageToAllActiveProjects(`${broadcast}`)
          }

          if(filter.isVulgar(text)) {
               let sentTo = project.session.getConnectedUsernames().filter(uname=>uname!=sender?.toLowerCase())
               let loggingMsg = '🔴 FILTERED CHAT: ' + '"' + text + '" [' + sender + '->' + sentTo.join(',') + ' | scratchid: ' + project.scratchId + ']'
               
               text = filter.getCensored(text)
               data.msg.msg.text = text
              
               loggingMsg = loggingMsg + `\nCensored as: "${text}"`
               console.error(loggingMsg)
               postText(loggingMsg)
               // text = '*'.repeat(text.length)
          // return;
          }

          if(banned?.includes?.(sender)) {return;}

          project?.onChat(data.msg,client)
          // logging
          let sentTo = project.session.getConnectedUsernames().filter(uname=>uname!=sender?.toLowerCase())
          let loggingMsg = '"' + text + '" [' + sender + '->' + sentTo.join(',') + ' | scratchid: ' + project.scratchId + ']'
          console.log(loggingMsg)
          postText(loggingMsg)
     }
}

let sendMessages = ['blProjectInfo','projectChange','loadFromId','projectChanges']

if(httpsServer){ioHttps.on('connection', onSocketConnection);}
ioHttp.on('connection', onSocketConnection);
function onSocketConnection(client) {
     client.on("message",(data,callback)=>{
          // console.log('message recieved',data,'from: ' + client.id)
          if(data.type in messageHandlers) {

               // record analytic first to stop reloading after project leave
               analytic: try{
                    let id = data.blId ?? data.id ?? null;
                    if (!id) { break analytic }
                    let project = sessionManager.getProject(id);
                    if (!project) { break analytic }
                    let connected = project.session?.getConnectedUsernames();
                    connected?.forEach?.(username => {
                         addRecent(username, connected.length>1, project.sharedWith.length)
                    })
               } catch (e) { console.error('error with analytic message tally'); console.error(e) }

               try{messageHandlers[data.type](data,client,callback)}
               catch(e){console.error('error during messageHandler',e)}
          } else { console.log('discarded unknown mesage type: ' + data.type) }
     })

     client.on('disconnect',(reason)=>{
          sessionManager.disconnectSocket(client)
     })
}

app.post('/newProject/:scratchId/:owner',(req,res)=>{
     if(!authenticate(req.params.owner,req.headers.authorization)) {res.send({noauth:true}); return;}

     console.log('yeetee')
     if(sanitize(req.params.scratchId + '') == '') {res.send({err:'invalid scratch id'}); return}
     let project = sessionManager.getScratchToBLProject(req.params.scratchId)
     let json = req.body;
     if(!project) {
          console.log('creating new project from scratch project: ' + req.params.scratchId + " by " + req.params.owner + ' titled: ' + req.query.title)
          project = sessionManager.newProject(req.params.owner,req.params.scratchId,json,req.query.title)
          userManager.newProject(req.params.owner,project.id)
     }
     res.send({id:project.id})
})

// app.get('/blId/:scratchId',(req,res)=>{
//      // res.send(sessionManager.scratchprojects[req.params.scratchId]?.blId)
//      res.send(sessionManager.getScratchProjectEntry(req.params.scratchId)?.blId)
// })
app.get('/blId/:scratchId/:uname',(req,res)=>{
     // let blId = sessionManager.scratchprojects[req.params.scratchId]?.blId
     let blId = sessionManager.getScratchProjectEntry(req.params.scratchId)?.blId
     if(!blId) {res.send(blId); return;}
     let project = sessionManager.getProject(blId)
     if(!project) { // if the project doesnt exist, dont send it!!!
          sessionManager.deleteScratchProjectEntry(req.params.scratchId)
          res.send(null); 
          return;
     }
     let hasAccess = fullAuthenticate(req.params.uname,req.headers.authorization,blId)
     // let hasAccess = project.isSharedWithCaseless(req.params.uname)

     res.send(hasAccess ? blId : null);
})
app.get('/scratchIdInfo/:scratchId',(req,res)=>{
     if (sessionManager.doesScratchProjectEntryExist(req.params.scratchId)) {
          res.send(sessionManager.getScratchProjectEntry(req.params.scratchId))
     } else {
          res.send({err:('could not find blocklive project associated with scratch project id: ' + req.params.scratchId)})
     }
})
// todo: sync info and credits with this endpoint as well?
app.get('/projectTitle/:id',(req,res)=>{
     if(!fullAuthenticate(req.headers.uname,req.headers.authorization,req.params.id)) {res.send({noauth:true}); return;}

     let project = sessionManager.getProject(req.params.id)
     if(!project) {
          res.send({err:'could not find project with blocklive id: ' + req.params.id})
     } else {
          res.send({title:project.project.title})
     }
})
// app.post('/projectSaved/:scratchId/:version',(req,res)=>{
//      console.log('saving project, scratchId: ',req.params.scratchId, ' version: ',req.params.version)
//      let project = sessionManager.getScratchToBLProject(req.params.scratchId)
//      if(!project) {console.log('could not find project!!!');
//      res.send('not as awesome awesome :)')
//      return;
// }
//      project.scratchSaved(req.params.scratchId,parseFloat(req.params.version))
//      res.send('awesome :)')
// })
app.post('/projectSavedJSON/:blId/:version',(req,res)=>{
     if(!fullAuthenticate(req.headers.uname,req.headers.authorization,req.params.blId)) {res.send({noauth:true}); return;}

     let json = req.body;
     // console.log('saving project, blId: ',req.params.blId, ' version: ',req.params.version, 'json is null?: ' + !json)
     let project = sessionManager.getProject(req.params.blId)
     if(!project) {console.log('could not find project!!!');
          res.send('not as awesome awesome :)')
          return;
     }
     project.scratchSavedJSON(json,parseFloat(req.params.version))
     res.send('awesome :)')
})
app.get('/projectJSON/:blId',(req,res)=>{
     if(!fullAuthenticate(req.query.username,req.headers.authorization,req.params.blId)) {res.send({noauth:true}); return;}

     let blId = req.params.blId;
     let project = sessionManager.getProject(blId);
     if(!project) {res.sendStatus(404); return;}
     let json = project.projectJson;
     let version = project.jsonVersion
     res.send({json,version});
     return;
})

app.use('/html',express.static('static'))
// app.get('/whereTo/:username/:scratchId',(req,res)=>{
//      if (req.params.scratchId in sessionManager.scratchprojects) {
//           let project = sessionManager.getScratchToBLProject(res.params.scratchId)
//           let possibleProject = project.getOwnersProject(req.params.username)
//           if(possibleProject) {
//                res.send({scratchId:possibleProject.scratchId, blId:project.id, owner:possibleProject.owner})
//           } else {
//                res.send(sessionManager.scratchprojects[req.params.scratchId])
//           }

//      } else {
//           res.send({err:('could not find blocklive project associated with scratch project id: ' + req.params.scratchId)})
//      }
// })
app.get('/changesSince/:id/:version',(req,res)=>{
     if(!fullAuthenticate(req.headers.uname,req.headers.authorization,req.params.id)) {res.send({noauth:true}); return;}

     let project = sessionManager.getProject(req.params.id)
     if(!project) {res.send([])}
     else {

          let oldestChange = project.project.getIndexZeroVersion();
          let clientVersion = req.params.version;
          let jsonVersion = project.jsonVersion;
          let forceReload = clientVersion<oldestChange-1 && jsonVersion>=oldestChange-1;
          if(clientVersion<oldestChange-1 && jsonVersion<oldestChange-1) {console.error('client version too old AND json version too old. id,jsonVersion,clientVersion,indexZeroVersion',project.id,jsonVersion,clientVersion,oldestChange)}

          let changes = project.project.getChangesSinceVersion(parseFloat(req.params.version));
          if(forceReload) {
               changes=buildMagicList(changes);
               changes.forceReload=true;
          }

          res.send(changes)
     }
})
function buildMagicList(list) {
     let output={length:list.length}
     for(let i=0; i<list.length; i++) {
          output[i]=list[i]
     }
     return output
}

app.get('/chat/:id',(req,res)=>{
     if(!fullAuthenticate(req.headers.uname,req.headers.authorization,req.params.id)) {res.send({noauth:true}); return;}


     let project = sessionManager.getProject(req.params.id)
     if(!project) {res.send([])}
     else {
          res.send(project.getChat())
     }
})
let cachedStats = null;
let cachedStatsTime = 0;
let cachedStatsLifetimeMillis = 1000;
app.use('/stats',basicAuth({
     users: adminUser,
     challenge: true,
 }))
app.get('/stats',(req,res)=>{
     if(Date.now() - cachedStatsTime > cachedStatsLifetimeMillis) {
          cachedStats = sessionManager.getStats()
          cachedStats.cachedAt = new Date();
          cachedStatsTime = Date.now()
     } 
     res.send(cachedStats)
})

app.get('/dau/:days',(req,res)=>{
     res.send(String(countRecentShared(parseFloat(req.params.days))))
})
app.put('/linkScratch/:scratchId/:blId/:owner',(req,res)=>{
     if(!fullAuthenticate(req.params.owner,req.headers.authorization,req.params.blId)) {res.send({noauth:true}); return;}

     console.log('linking:',req.params)
     sessionManager.linkProject(req.params.blId,req.params.scratchId,req.params.owner,0)
     res.send('cool :)')
})
// app.get('/projectInpoint/:blId',(req,res)=>{
//      let project = sessionManager.getProject(req.params.blId)
//      if(!project) {
//           // res.status(404)
//           res.send({err:'project with id: ' +req.params.blId+' does not exist'})
//      }
//      else {
//           let scratchId = project.scratchId
//           // let changes = project.project.getChangesSinceVersion(project.scratchVersion)
//           res.send({scratchId,scratchVersion:project.scratchVersion})
//      }
// })
app.get('/userRedirect/:scratchId/:username',(req,res)=>{

     let project = sessionManager.getScratchToBLProject(req.params.scratchId)

     if(!fullAuthenticate(req.params.username,req.headers.authorization,project?.id)) {res.send({noauth:true,goto:'none'}); return;}

     if(!project) {res.send({goto:'none'})}
     else {
          let ownedProject = project.getOwnersProject(req.params.username)
          if(!!ownedProject) {
               res.send({goto:ownedProject.scratchId})
          } else {
               res.send({goto:'new', blId:project.id})
          }
     }
})
// app.get('/projectInpoint',(req,res)=>{
//      res.send({err:"no project id specified"})
// })

app.get('/active/:blId',(req,res)=>{
     if(!fullAuthenticate(req.headers.uname,req.headers.authorization,req.params.blId)) {res.send({noauth:true}); return;}

     let usernames = sessionManager.getProject(req.params.blId)?.session.getConnectedUsernames()
     let clients = sessionManager.getProject(req.params.blId)?.session.getConnectedUsersClients()
     if(usernames) {
          res.send(usernames.map(name=>{
               let user = userManager.getUser(name)
               return {username:user.username,pk:user.pk,cursor:clients[name].cursor}
          }))
     } else {
          res.send({err:'could not get users for project with id: ' + req.params.blId})
     }
})

app.get('/',(req,res)=>{
     res.send('wow youre a hacker wow')
})

app.post('/friends/:user/:friend',(req,res)=>{
     if(!authenticate(req.params.user,req.headers.authorization)) {res.send({noauth:true}); return;}

     userManager.befriend(req.params.user,req.params.friend)
     res.send('awwww :)')
})
app.delete('/friends/:user/:friend',(req,res)=>{
     if(!authenticate(req.params.user,req.headers.authorization)) {res.send({noauth:true}); return;}

     userManager.unbefriend(req.params.user,req.params.friend)
     res.send('sadge moment :<(')

})
app.get('/friends/:user',(req,res)=>{
     recordPopup(req.params.user)
     if(!authenticate(req.params.user,req.headers.authorization)) {res.send({noauth:true}); return;}

     res.send(userManager.getUser(req.params.user)?.friends)
})

// get list of blocklive id's shared TO user (from another user)
app.get('/userProjects/:user',(req,res)=>{
     if(!authenticate(req.params.user,req.headers.authorization)) {res.send({noauth:true}); return;}

     res.send(userManager.getShared(req.params.user))
})
// get list of scratch project info shared with user for displaying in mystuff
app.get('/userProjectsScratch/:user',(req,res)=>{
     if(!authenticate(req.params.user,req.headers.authorization)) {res.send({noauth:true}); return;}

     let blockliveIds = userManager.getAllProjects(req.params.user)
     let projectsList = blockliveIds.map(id=>{
          let projectObj = {}
          let project = sessionManager.getProject(id)
          if(!project) {return null}
          projectObj.scratchId = project.getOwnersProject(req.params.user)?.scratchId
          if(!projectObj.scratchId) {projectObj.scratchId = project.scratchId}
          projectObj.blId = project.id;
          projectObj.title = project.project.title
          projectObj.lastTime = project.project.lastTime
          projectObj.lastUser = project.project.lastUser
          projectObj.online = project.session.getConnectedUsernames()

          return projectObj
     }).filter(Boolean) // filter out non-existant projects // TODO: automatically delete dead pointers like this
     res.send(projectsList)
})

app.put('/leaveScratchId/:scratchId/:username',(req,res)=>{    
     if(!authenticate(req.params.username,req.headers.authorization)) {res.send({noauth:true}); return;}
     
     let project = sessionManager.getScratchToBLProject(req.params.scratchId)
     userManager.unShare(req.params.username, project.id)
     sessionManager.unshareProject(project.id, req.params.username)
     res.send('uncool beans!!!! /|/|/|')
})
app.put('/leaveBlId/:blId/:username',(req,res)=>{
     if(!authenticate(req.params.username,req.headers.authorization)) {res.send({noauth:true}); return;}

     // let project = sessionManager.getScratchToBLProject(req.params.scratchId)
     userManager.unShare(req.params.username, req.params.blId)
     sessionManager.unshareProject(req.params.blId, req.params.username)
     res.send('uncool beans!!!! /|/|/|')
})
app.get('/verify/test',(req,res)=>{
     res.send({verified:authenticate(req.query.username,req.headers.authorization),bypass:bypassUserAuth})
})


app.get('/share/:id',(req,res)=>{
     if(!fullAuthenticate(req.headers.uname,req.headers.authorization,req.params.id)) {res.send({noauth:true}); return;} // todo fix in extension

     let project = sessionManager.getProject(req.params.id)
     let list = project?.sharedWith
     if(!list) {res.send('yeet yeet'); return;}
     list = list.map(name=>({username:name,pk:userManager.getUser(name).pk})) // Add user ids for profile pics
     res.send(list ? [{username:project.owner,pk:userManager.getUser(project.owner).pk}].concat(list) : {err:'could not find blocklive project: ' + req.params.id} )
})
app.put('/share/:id/:to/:from',(req,res)=>{
     if(!fullAuthenticate(req.params.from,req.headers.authorization,req.params.id)) {res.send({noauth:true}); return;}

     if(sessionManager.getProject(req.params.id)?.owner == req.params.to) {
          res.send('i lost all mah beans!!!!')
          return
     }
     sessionManager.shareProject(req.params.id, req.params.to, req.query.pk)
     userManager.getUser(req.params.to).pk = req.query.pk
     userManager.share(req.params.to, req.params.id, req.params.from)
     res.send('cool beans ()()()')
})
app.put('/unshare/:id/:to/',(req,res)=>{
     if(!fullAuthenticate(req.headers.uname,req.headers.authorization,req.params.id)) {res.send({noauth:true}); return;}

     if(sessionManager.getProject(req.params.id)?.owner == req.params.to) {
          res.send('you stole me beanz didnt u!!!?!?!?!?')
          return
     }
     sessionManager.unshareProject(req.params.id, req.params.to)
     userManager.unShare(req.params.to, req.params.id)
     res.send('uncool beans!!!! /|/|/|')
})
app.get('/verify/bypass',(req,res)=>{
     res.send(bypassUserAuth)
})

export let numWithCreds = 0
export let numWithoutCreds = 0
//bypassBypass means to bypass the bypass even if the bypass is enabled
function fullAuthenticate(username,token,blId,bypassBypass) {
     if(token) {numWithCreds++}
     else {numWithoutCreds++}
     // and remove line 448 "sessionManager.canUserAccessProject"
     if(!username) { console.error(`undefined username attempted to authenticate on project ${blId} with token ${token}`); username = '*'}
     let userAuth = authenticate(username,token,bypassBypass)
     let isUserBypass = (bypassUserAuth && !bypassBypass);
     let authAns = ((userAuth || isUserBypass)) && (sessionManager.canUserAccessProject(username,blId) ||
          admin.includes(username));
     if(!authAns && (userAuth || isUserBypass)) {
          console.error(`🟪☔️ Project Authentication failed for user: ${username}, bltoken: ${token}, blId: ${blId}`)
     }
     return authAns
}

const httpPort = 4001
const httpsPort = 4000
httpServer.listen(httpPort,'0.0.0.0');
console.log('listening http on port ' + httpPort)
if(httpsServer) {
     httpsServer.listen(httpsPort,'0.0.0.0'); 
     console.log('listening https on port ' + httpsPort)
}


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

     if(options.exit) {finalSave();}

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