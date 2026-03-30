class LivescratchProject {
    // projectJSON
    // projectJSONVersion = 0
    version = -1;
    changes = [];

    constructor() {
    }

    recordChange(change) {
        this.changes.push(change);
        this.version++;
    }

    getChangesSinceVersion(lastVersion) {
        return this.changes.slice(lastVersion);
    }

    hasHistory(untilVersion) {
        return (this.version-untilVersion) <= this.changes.length;
    }

    setVersion(toVersion) {
        if(toVersion > this.version) {
            this.changes = [];
        }
        this.version = toVersion;
    }
}