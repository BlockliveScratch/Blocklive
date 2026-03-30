import { ProfanityEngine } from '@coffeeandfun/google-profanity-words';
import fs from 'fs';
import path from 'path';

export class Filter {
    constructor(language = 'en') {
        this.profanityEngine = new ProfanityEngine({ language }); // Initialize with specified language
        this.leetspeakMap = {};
        this.loadLeetspeakMap();
    }

    /**
     * Load the leetspeak map from the JSON file.
     */
    loadLeetspeakMap() {
        try {
            const filePath = path.resolve(process.cwd(), 'utils', '_leetspeakMap.json'); // Adjust path as needed
            const data = fs.readFileSync(filePath, 'utf-8'); // Synchronously read the JSON file
            this.leetspeakMap = JSON.parse(data); // Parse and assign to the map
            console.log('Leetspeak map loaded successfully:', this.leetspeakMap);
        } catch (error) {
            console.error('Error loading leetspeak map:', error.message);
            throw new Error('Failed to load leetspeak map');
        }
    }    

    /**
     * Normalize text by converting leetspeak to plain text.
     * @param {string} text - Input text to normalize.
     * @returns {string} - Normalized text.
     */
    normalizeLeetspeak(text) {
        return text.replace(/[@$3107!5]/g, char => this.leetspeakMap[char] || char);
    }

    /**
     * Check if the given content contains bad words.
     * @param {string} content - The input string to check for profanity.
     * @returns {Promise<{ isBad: boolean, badWordsTotal: number, badWordsList: string[], censoredContent: string }>}
     */
    async checkContent(content) {
        try {
            // Normalize content to handle leetspeak
            const normalizedContent = this.normalizeLeetspeak(content);

            // Check if the content contains curse words
            const hasCurseWords = await this.profanityEngine.hasCurseWords(normalizedContent);

            // Retrieve all bad words from the package (static list)
            const badWordsList = hasCurseWords
                ? (await this.profanityEngine.all()).filter(word =>
                    new RegExp(`\\b${word}\\b`, 'i').test(normalizedContent),
                )
                : [];

            // Generate censored content
            const censoredContent = badWordsList.reduce(
                (censored, word) =>
                    censored.replace(new RegExp(`\\b${word}\\b`, 'gi'), '*'.repeat(word.length)),
                normalizedContent,
            );

            return {
                isBad: hasCurseWords,
                badWordsTotal: badWordsList.length,
                badWordsList,
                censoredContent,
            };
        } catch (error) {
            console.error('Error checking content:', error.message);
            throw new Error('Failed to process content with ProfanityEngine');
        }
    }

    /**
     * Determines if the input text is vulgar.
     * @param {string} text - The input text.
     * @returns {Promise<boolean>} - Returns true if vulgar, otherwise false.
     */
    async isVulgar(text) {
        const result = await this.checkContent(text);
        return result.isBad;
    }

    /**
     * Gets the censored version of the input text.
     * @param {string} text - The input text.
     * @returns {Promise<string>} - Returns the censored text.
     */
    async getCensored(text) {
        const result = await this.checkContent(text);
        return result.censoredContent || text; // Return censored content if available
    }
}
