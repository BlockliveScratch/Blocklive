import Lines from 'n-readlines'

export class WordCompressor {
    collapseMap = {}
    removeWords = []
    okWords = {}
    allChars='abcdefghijklmnopqrstuvwxyz '

    addOkWord(word) {
        this.okWords[word] = true
    }
    removeOkWords(phrase) {
        phrase.split(' ').forEach(originalWord=>{
            let word = originalWord.toLowerCase()
            if(word in this.okWords) {
                phrase = phrase.replace(originalWord,'')
            }
        })
        return phrase
    }

    addMapping(list, to) {
        list.forEach(key => {
            this.collapseMap[key] = to
        });
    }

    setAllChars(allChars) {
        this.allChars=allChars;
    }

    getOnlyAllChars(phrase) {
        let regex = new RegExp(`[^${this.allChars}]`,'g')
        return phrase.replace(regex,'')
    }

    addRemove(bit) {
        this.removeWords.push(bit)
    }

    shear(phrase) {
        this.removeWords.forEach(bit => { phrase = phrase.split(bit).join('') })
        return phrase
    }

    compress(word) {

        // this.removeWords.forEach(bit => { word = word.split(bit).join('') })

        word = this.shear(word)
        // word = this.singleChars(word)


        for (let i = 0; i < word.length - 1; i += 1) {
            let char = '' + word[i] + word[i + 1]
            if (char == '' + char[0] + char[0]) {
                word = this.setCharAt(word, i, '')
                i -= char.length - 1
            }
        }


        for (let i = 0; i < word.length - 1; i += 1) {
            let char = '' + word[i] + word[i + 1]
            if (char in this.collapseMap) {
                for (let j = 0; j < char.length - 1; j++) {
                    word = this.setCharAt(word, i + 1, '')
                }
                word = this.setCharAt(word, i, this.collapseMap[char])
                i -= char.length - 1
                i += this.collapseMap[char].length - 1
            }
        }
        word = this.getOnlyAllChars(word) // remove non letters and numbers

        word = this.singleChars(word)



        for (let i = 0; i < word.length - 1; i += 1) {
            let char = '' + word[i] + word[i + 1]
            if (char == '' + char[0] + char[0]) {
                word = this.setCharAt(word, i, '')
                i -= char.length - 1
            }
        }


        word = this.singleChars(word)

        return word
    }

    singleChars(word) {
        for (let i = 0; i < word.length; i += 1) {
            let char = word[i]
            if (char in this.collapseMap) {
                word = this.setCharAt(word, i, this.collapseMap[char])
            }
        }
        return word
    }

    setCharAt(str, index, chr) {
        if (index > str.length - 1) return str;
        return str.substr(0, index) + chr + str.substr(index + 1);
    }
}



export const StringTreeNode = class {

    isEnd = false

    constructor() {
        this.addString = (string, i) => {
            this.summon(string, i).isEnd = true;
        }
        this.summon = (string, i) => {
            if (i >= string.length) { return this }
            let ch = string[i];
            // console.log(ch)
            let ret = this[ch];
            if (ret == null) {
                ret = new StringTreeNode();
                this[ch] = ret
            }
            return ret.summon(string, i + 1)
        }
        this.containsString = (string, i) => {
            if (this.isEnd) { return true }
            let next = this[string[i]]
            // console.log(string[i])
            if (next == null) { return false }
            if (next.isEnd) { return true }
            return this[string[i]].containsString(string, i + 1)
        }

    }


}




export class SubstringTester {

    constructor() {
        this.root = new StringTreeNode();
    }

    addWord(word) {
        this.root.addString(word, 0)
        this.words[word] = true
    }

    removeWord(word) {
        if (word in words) { return false }
        root.summon(word, 0).isEnd = false
    }

    containsWord(phrase) {
        // console.log(this.root)
        for (let i = 0; i < phrase.length; i++) {
            if (this.root.containsString(phrase, i)) { return true }
        }
        return false
    }



    words = {}

}


export class Filter {

    spaceWords = {}
    addSpaceWord(word) {
        this.spaceWords[word] = true;
    }

    hasSpaceWord(phrase) {
        for(let word of phrase.split(' ')) {
            if(word in this.spaceWords) {return true} // hello -> hello
            if(this.compressor.compress(word) in this.spaceWords) {return true} // jjjjacket -> jacket
        }
        return false;
    }

    constructor() {
        this.compressor = new WordCompressor();
        this.tester = new SubstringTester();
    }

    loadDefault() {
        let c = this
        c.addMapping(['o', '0', 'O'], 'o')
        c.addMapping([' ', '-', '_', '*', '+', '^', '.'], '')
        // c.addMapping(['z'], 's')
        // c.addMapping(['q'], 'p')
        c.addMapping(['ck'], 'c')
        c.addMapping(['k'], 'c')
        c.addMapping(['$'], 's')
        // c.addMapping(['3'], 'e')
        // c.addMapping(['5'], 's')
        c.addMapping(['ch'], 'x')
        c.addMapping(['1', 'l'], 'i')
        c.addMapping(['e'],'i') // experimental mapping
        // c.addMapping(['cc'], 'ch')

        this.compressor.setAllChars('abcdefghijklmnopqrstuvwxyz123456789 ')

        let lines = new Lines('./filterwords/badwords.txt')
        let line;
        while (line = lines.next()) {
            c.addWord(line.toString('ascii'));
        }

        lines = new Lines('./filterwords/badwordsNoComp.txt')
        while (line = lines.next()) {
            this.tester.addWord(line.toString('ascii'));
        }

        lines = new Lines('./filterwords/bademojis.txt')
        while (line = lines.next()) {
            this.tester.addWord(line.toString());
        }

        lines = new Lines('./secrets/baddomains.txt')
        while (line = lines.next()) {
            this.tester.addWord(line.toString('ascii'));
        }

        lines = new Lines('./filterwords/okWords.txt')
        while (line = lines.next()) {
            this.compressor.addRemove(line.toString('ascii').toLowerCase());
        }

        lines = new Lines('./filterwords/spacewords.txt')
        while (line = lines.next()) {
            this.addSpaceWord(line.toString('ascii'))
        }

        lines = new Lines('./filterwords/processedOkSpaceWords.txt')
        while (line = lines.next()) {
            this.compressor.addOkWord(line.toString('ascii'))
        }
    }

    addWord(word) {
        this.tester.addWord(this.compressor.compress(word))
        this.tester.addWord(word)
    }

    addMapping(from, to) {
        this.compressor.addMapping(from, to)
    }

    isVulgar(string) {
        // string = this.compressor.removeOkWords(string)
        return this.tester.containsWord(this.compressor.compress(string.toLowerCase())) || this.tester.containsWord(this.compressor.shear(string.toLowerCase() + " ")) || this.hasSpaceWord(string.toLowerCase())
    }
    getCensored(string) {
        return string.split(' ').map(word=>(word.toLowerCase() in this.compressor.okWords) ? word : '*'.repeat(word.length)).join(' ')
    }
}

