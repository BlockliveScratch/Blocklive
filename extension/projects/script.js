var version = chrome.runtime.getManifest().version;
document.querySelector('#version').innerHTML = 'v'+version;

async function getProjects() {
    let info = await chrome.runtime.sendMessage({meta:'getUsernamePlus'});
    let apiUrl = info.apiUrl;
    let blToken = info.token;
    let uname = info.uname;
 
    var data = await (
        await fetch(
            `${apiUrl}/userProjectsScratch/${uname}/`,
            {headers:{authorization:blToken}},
        )
    ).json();
    if (data.length === 0) {
        var span = document.createElement('span');
        span.className = 'title';
        span.textContent = 'Nothing here! LiveScratch share a project to see it here!';
        document.querySelector('.projects').appendChild(span);
    }
    data.forEach(function (project) {
        var div = document.createElement('div');
        div.className = 'project';

        var img = document.createElement('img');
        img.src = `https://cdn2.scratch.mit.edu/get_image/project/${project.scratchId}_480x360.png`;

        var title = document.createElement('span');
        title.className = 'title';
        title.textContent = project.title;

        div.appendChild(img);
        div.appendChild(title);
        document.querySelector('.projects').appendChild(div);

        div.addEventListener('click', function () {
            chrome.tabs.create({
                url: `https://scratch.mit.edu/projects/${project.scratchId}/editor`,
            });
        });
    });
}
getProjects();
