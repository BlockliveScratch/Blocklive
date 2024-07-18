const SAVE_FILENAME = 'processedOkSpaceWords.txt'

import fs from 'fs'

let allwords = fs.readFileSync('allwords.txt').toString()
let bad1 = fs.readFileSync('badwords.txt').toString()
let bad2 = fs.readFileSync('spacewords.txt').toString()
let bad3 = fs.readFileSync('morebadwords.txt').toString()
let allBad =
[
...bad1.toLowerCase().split('\n'),
...bad2.toLowerCase().split('\n'),
...bad3.toLowerCase().split('\n'),
]
allBad = [...new Set(allBad)]
let allBadMap = Object.fromEntries(allBad.map(word=>[word,true]))
// console.log(allBad)


let filtered =allwords.toLowerCase().split('\n').filter(line=>
    // allBad.filter(bad=>line.includes(bad)).length>0
    !(allBad.filter(bad=>bad.length>3).filter(bad=>line.includes(bad)).length>0 ||
    line in allBadMap)
)
filtered = filtered.filter(word=>word.length>2)

console.log(filtered)

fs.writeFileSync(SAVE_FILENAME,filtered.join('\n'));
console.log(`./${SAVE_FILENAME}`);