import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path';
import sanitize from 'sanitize-filename';
import clone from 'clone'

export const blocklivePath = 'storage/sessions/blocklive'
export const scratchprojectsPath = 'storage/sessions/scratchprojects'
export const lastIdPath = 'storage/sessions/lastId'
export const usersPath = 'storage/users'


function sleep(millis) {
    return new Promise(res=>setTimeout(res,millis))
}
if(!fs.existsSync('storage')) {
    fs.mkdirSync('storage')
}

export function saveMapToFolder(obj, dir) {
    // if obj is null, return
    if(!obj) {console.error('tried to save null object to dir: ' + dir); return}
    // make directory if it doesnt exist
    if (!fs.existsSync(dir)){fs.mkdirSync(dir,{recursive:true})}
    Object.entries(obj).forEach(entry=>{
     let stringg = JSON.stringify(entry[1])
     if(stringg.length >= removeChangesStringLength && entry[1]?.project?.changes) {
          entry[1] = clone(entry[1],true,2)
          entry[1].project.changes=[]
          stringg = JSON.stringify(entry[1])
     } //max length is 524288

         entry[0] = sanitize(entry[0] + '')
         if(entry[0] == '' || stringg.length > maxStringWriteLength) {
          console.error(`skipping writing file "${entry[0]}" because its too long or noname`)
          return
     }
         try{
               console.log(`writing ${entry[0]}`)
               fs.writeFileSync(dir+path.sep+entry[0],stringg)
         } catch (e) {
              console.error('Error when saving filename: ' + entry[0])
              console.error(e)
         }
    })
}

const removeChangesStringLength = 514280;
const maxStringWriteLength = 51428000; //absolute max, hopefully never reached
export async function saveMapToFolderAsync(obj, dir, failsafeEh, dontRemoveChanges) {
     // if obj is null, return
     if(!obj) {console.warn('tried to save null object to dir: ' + dir); return}
     // make directory if it doesnt exist
     if (!fs.existsSync(dir)){fs.mkdirSync(dir,{recursive:true})}
     let promises = []
     for (let entry of Object.entries(obj)) {
          let id = sanitize(entry[0] + '')
          let contentsObject = entry[1]
          let stringg = JSON.stringify(contentsObject);
          if(stringg.length >= removeChangesStringLength && contentsObject?.project?.changes && !dontRemoveChanges) {
               console.log(`removing changes to save length on projectId: ${id}`)
               contentsObject = clone(contentsObject,true,2)
               contentsObject.project.changes=[]
               stringg = JSON.stringify(contentsObject)
          } //max length is 524288
          if(failsafeEh) { // to speed up the saving process because we know that the actual save will write changes, and this is quick in case the server crashes
               if(contentsObject?.project?.changes) {
                    contentsObject = clone(contentsObject,false,2)
                    contentsObject.project.changes=[]
                    stringg = JSON.stringify(contentsObject)
               }
          }

          if(!id || stringg.length >= maxStringWriteLength) {
               console.error(`skipping writing project ${id} because its too long or noname`)
               return
          }
          let filename = dir+path.sep+id;
          await fsp.writeFile(filename,stringg).catch(e=>{console.error('Error when saving filename:');console.error(e)})
     }
 }
export function loadMapFromFolder(dir) {
    let obj = {}
    // check that directory exists, otherwise return empty obj
    if(!fs.existsSync(dir)) {return obj}
    // add promises
    fs.readdirSync(dir,{withFileTypes:true})
         .filter(dirent=>dirent.isFile())
         .map(dirent=>([dirent.name,fs.readFileSync(dir + path.sep + dirent.name)]))
         .forEach(entry=>{
              try{
                   obj[entry[0]] = JSON.parse(entry[1]) // parse file to object
              } catch (e) {
                   console.error('json parse error on file: ' + dir + path.sep + "\x1b[1m" /* <- bold */ + entry[0] + "\x1b[0m" /* <- reset */)
                    fs.rmSync(dir + path.sep + entry[0])
               }
    })
    return obj
}