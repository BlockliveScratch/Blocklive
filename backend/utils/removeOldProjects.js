/// for some reason this causes a ton of issues :/

import { livescratchPath, scratchprojectsPath } from './fileStorage.js';
import fs from 'fs';
import cron from 'node-cron';

function sleep(millis) {
    return new Promise(res => setTimeout(res, millis));
}

let inprog=false;
export function installCleaningJob(sessionManager, userManager) {
    // removeOldProjectsAsync(sessionManager, userManager);
    // removeUntetheredScratchprojects(sessionManager,userManager)
    cron.schedule(CRON_EXPRESSION, async () => {
        if(inprog) {return;} // dont do it twice
        inprog=true;
        await removeOldProjectsAsync(sessionManager, userManager);
        await removeUntetheredScratchprojects(sessionManager,userManager);
        inprog=false;
    },{
        scheduled: true,
        timezone: 'Asia/Qatar',
    });
}

const HOW_OLD_DAYS = 60; // delete projects with no new edits in the last this number of days
const CRON_EXPRESSION = '0 2 * * *'; // every night at 2am

async function removeOldProjectsAsync(sessionManager, userManager) {
    fs.readdir(livescratchPath, async (err, files) => {
        console.log('removal test started', files);
        for (let id of files) {
            await sleep(55); // rate limit might fix issues??????? IM LOSSTTTTTTTT!!!
            try {

                console.log('probing project with id ' + id);
                let project = sessionManager.getProject(id);
                if (!project) {
                    console.log('project doesnt exist, DELETING id ' + id);
                    sessionManager.deleteProjectFile(id); // WARNING- WILL DELETE ALL PROJECTS IF TOO MANY FILES ARE OPEN. CONSIDER REMOVING THIS LINE IN THE FUTURE WHEN LIVESCRATCH HAS TOO MANY FOLKS
                } //todo check if project not existing messes up delete function
                else { // if project does exist
                    id = project.id; // since we know that project.id exists

                    if (Object.keys(project.session.connectedClients).length == 0) {
                        if (project.project.lastTime && Date.now() - new Date(project.project.lastTime) > HOW_OLD_DAYS * 24 * 60 * 60 * 1000) {

                            console.log(`deleting project ${id} because it is old`);

                            [project.owner, ...project.sharedWith].forEach(username => {
                                userManager.unShare(username, id);
                                sessionManager.unshareProject(id, username);
                            });

                            sessionManager.deleteProjectFile(id);
                        } else {
                            project.trimChanges();
                            await sessionManager.offloadProjectAsync(id);
                        }
                    }
                }
            }
            catch (e) {
                console.error(`error while probing project ${id}:`, e);
            }
        }
    });
}


async function removeUntetheredScratchprojects(sessionManager, userManager) {

    fs.readdir(scratchprojectsPath, async (err, files) => {
        console.log('removal scratchprojectsentries test started', files);
        for (let scratchid of files) {

            await sleep(60);
            let entry = sessionManager.getScratchProjectEntry(scratchid);
            if(!entry) {
                sessionManager.deleteScratchProjectEntry(scratchid);
                continue;
            }
            let id = entry.blId;
            let project = sessionManager.getProject(id);
            if (!project) {
                sessionManager.deleteScratchProjectEntry(scratchid);
                continue;
            }
        }
    },
    );
}