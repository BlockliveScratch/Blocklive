
import { bypassAuth } from "./index.js";
import { ids } from "./secrets/secrets.js";
import fs from 'fs'
export const freePassesPath = 'storage/freePasses.json'
export const failedAuthLog = {}

const AUTH_PROJECTID = 854593681;

function logAuth(username, success, word) {
    if (!username) { return; }
    if (success) {
        // console.error(`✅ Successfully ${word}ed user ${username}`)
        if (username in failedAuthLog) {
            delete failedAuthLog[username]
        }
    } else {
        failedAuthLog[username] = true;
        console.error(`🆘 Failed to ${word} user ${username}`)

    }
}

let pendingMap = {} // publicAuthCode : clientSecret 

function sleep(millis) {
    return new Promise(res => setTimeout(res, millis))
}


let idIndex = 0;
export function getAuthStats() {
    return { idIndex, info: getAuthProjectInfo(), failed: failedAuthLog }
}

function generateAuthCode() {
    return Math.floor(Math.random() * 1000000).toString()
}

function getAuthProjectInfo() {
    return AUTH_PROJECTID;
}

let userManager
let sessionManager
export function setPaths(app, userManagerr, sessionManagerr) {
    userManager = userManagerr
    sessionManager = sessionManagerr
    app.get('/verify/start', (req, res) => { // ?code=000000
        console.log('starting to authenticate a user')

        let clientCode = req.query.code;
        let verifyCode = generateAuthCode();

        pendingMap[clientCode] = verifyCode;
        res.send({ code: verifyCode, project: getAuthProjectInfo() })
    })

    const CLOUD_WAIT = 1000 * 5;
    app.get('/verify/userToken', async (req, res) => { // ?code=000000&method=cloud|CLOUDs
        try {
            let clientCode = req.query.code
            if (!clientCode) { res.send({ err: 'no client code included' }); return }
            let tempCode = pendingMap[clientCode];

            if (!tempCode) {
                res.send({ err: 'client code not found', clientCode });
                return;
            }

            let cloud = await getVerificationCloud(tempCode)
            if (!cloud || cloud?.err) {
                console.log("retrying...");
                await sleep(CLOUD_WAIT)
                cloud = await getVerificationCloud()
            }
            if (cloud?.code == 'nocon') {
                grantFreePass(req.headers.uname)
                logAuth(req.headers.uname, true, 'verify')
                res.send({ freepass: true })
                return;
            }
            if (!cloud) {
                res.send({ err: 'no cloud' })
                logAuth(req.headers.uname, false, 'verify')
                return;
            }
            console.log('cloud', cloud)
            delete pendingMap[tempCode];

            let username = cloud.user;
            let token = userManagerr.getUser(username)?.token
            if (!token) {
                res.send({ err: 'user not found', username });
                logAuth(username, false, 'verify')
                return;
            }

            deleteFreePass(username)
            res.send({ token, username })
            logAuth(username, true, 'verify')
            return;
        } catch (err) {
            next(err);
        }
    })
}

let cachedCloud = []
let cachedTime = 0;
let CLOUD_CHECK_RATELIMIT = 1000 * 2; // every 2 seconds

async function checkCloud() {
    try {
        cachedCloud = await (await fetch(`https://clouddata.scratch.mit.edu/logs?projectid=${AUTH_PROJECTID}&limit=40&offset=0&rand=${Math.random()}`)).json()
        cachedTime = Date.now()
        return cachedCloud
    } catch (e) {
        console.error(e);
        cachedCloud = { code: 'nocon' }
        idIndex = (idIndex + 1) % ids.projects.length
        return cachedCloud
    }
}
let checkCloudPromise = null;
async function queueCloudCheck() {
    if (checkCloudPromise) { return checkCloudPromise }
    return checkCloudPromise = new Promise(res => setTimeout(async () => {
        await checkCloud();
        checkCloudPromise = null;
        res(cachedCloud);
    }, CLOUD_CHECK_RATELIMIT))
}
async function checkCloudRatelimited() {
    if (Date.now() - cachedTime < CLOUD_CHECK_RATELIMIT) {
        return await queueCloudCheck()
    } else {
        return await checkCloud()
    }
}

async function getVerificationCloud(tempCode) {
    let vars = await checkCloudRatelimited()
    if (vars?.code) { return { code: 'nocon' } };
    let cloud = vars?.map(cloudObj => ({ content: cloudObj?.value, user: cloudObj?.user }));
    cloud = cloud.filter(com => String(com.content) == String(tempCode)).reverse()[0];
    return cloud;
}


// export let freePasses = {} // username : passtime

export let freePasses = fs.existsSync(freePassesPath) ? JSON.parse(fs.readFileSync(freePassesPath)) : {}
// grant temporary free verification to users if the blocklive server fails to verify
export function grantFreePass(username) {
    console.error('granted free pass to user ' + username)
    username = username?.toLowerCase?.()
    freePasses[username] = Date.now()
}
export function hasFreePass(username) {
    username = username?.toLowerCase?.()
    return username in freePasses
}
export function deleteFreePass(username) {
    username = username?.toLowerCase?.()
    if (username in freePasses) {
        console.error('removing free pass from user ' + username)
        delete freePasses[username];
    }
}


export function authenticate(username, token) {
    if (bypassAuth) { return true }
    let success = hasFreePass(username) || userManager.getUser(username).token == token
    if (success) {
        logAuth(username, true, 'authenticate')
    } else {
        logAuth(username, false, 'authenticate')
        // console.error(`🟪 User Authentication failed for user: ${username}, bltoken: ${token}`)

    }
    return success
}