import fsp from 'fs/promises';
import fs from 'fs';
import cron from 'node-cron';
import path from 'path';

const recentPath = 'storage/recent.json';

//load from file
let {recent,recentRealtime,recentShared,popup} = fs.existsSync(recentPath) ? JSON.parse(fs.readFileSync(recentPath)) : {recent:{},recentRealtime:{},recentShared:{},popup:[]};
if(!recent) {recent = {};}
if(!recentRealtime) {recentRealtime = {};}
if(!recentShared) {recentShared = {};}
if(!popup) {popup = [];}

const CRON_EXPRESSION = '0 1 * * *'; // every night at 1am
cron.schedule(CRON_EXPRESSION, async () => {
    trimRecent();
},{
    scheduled: true,
    timezone: 'Etc/GMT+3',
});

setInterval(saveRecent,1000);

// save to file
export async function saveRecent() {
    const dirPath = path.dirname(recentPath);
    await fsp.mkdir(dirPath, { recursive: true });
    
    await fsp.writeFile(recentPath,JSON.stringify({recent,recentRealtime,recentShared,popup}));
}

export function recordPopup(username) {
    username = username?.toLowerCase?.();
    let toPush = {u:username,t:Date.now()};
    popup.push(toPush);
}
export function countPopup(days) {
    let now = Date.now();
    let millis = days * 1000 * 60 * 60 * 24;
    let count = popup.filter(record=>record.t>now-millis).length;
    return count;
}
export function countUniquePopup(days) {
    let now = Date.now();
    let millis = days * 1000 * 60 * 60 * 24;
    let count = new Set(popup.filter(record=>record.t>now-millis).map(record=>record.u)).size;
    return count;
}

export function addRecent(username,realtime,shared) {
    username=username?.toLowerCase?.();
    recent[username] = Date.now();
    if(realtime) {
        recentRealtime[username] = Date.now();
    }
    if(shared) {
        recentShared[username] = Date.now();
    }
}

// remove older than 30 days
function trimRecent() {
    const DAYS = 30;

    let namesToDelete = Object.entries(recent).filter(entry=>(Date.now()-entry[1]>1000*60*60*24*DAYS)).map(entry=>entry[0]);
    namesToDelete.forEach(name=>{delete recent[name];});
    
    let namesToDeleteRealtime = Object.entries(recentRealtime).filter(entry=>(Date.now()-entry[1]>1000*60*60*24*DAYS)).map(entry=>entry[0]);
    namesToDeleteRealtime.forEach(name=>{delete recentRealtime[name];});

    let namesToDeleteShared = Object.entries(recentShared).filter(entry=>(Date.now()-entry[1]>1000*60*60*24*DAYS)).map(entry=>entry[0]);
    namesToDeleteShared.forEach(name=>{delete recentShared[name];});

    popup = popup.filter(entry=>(Date.now()-entry.t)<1000*60*60*24*DAYS);
}

export function countRecentShared(days) {
    const DAYS = days;
    return Object.entries(recentShared).filter(entry=>(Date.now()-entry[1]<1000*60*60*24*DAYS)).length;
}
export function countRecentRealtime(days) {
    const DAYS = days;
    return Object.entries(recentRealtime).filter(entry=>(Date.now()-entry[1]<1000*60*60*24*DAYS)).length;
}
export function countRecent(days) {
    const DAYS = days;
    return Object.entries(recent).filter(entry=>(Date.now()-entry[1]<1000*60*60*24*DAYS)).length;
}
export function countRecentBoth(days) {
    return {
        all:countRecent(),
        realtime:countRecentRealtime(),
        shared:countRecentShared(),
    };
}

