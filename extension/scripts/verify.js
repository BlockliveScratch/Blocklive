function askVerify() {
  chrome.runtime.sendMessage({ meta: 'verify?' }, async (response) => {
    if(!response) {return;}
    let res = await setCloudTempCode(response.code, response.project)
    chrome.runtime.sendMessage({ meta: 'setCloud', res })
  })
}
askVerify()

async function setCloudVar(value, AUTH_PROJECTID) { 
  const user = await chrome.runtime.sendMessage({ meta: 'getUsername' });
  if(user=='*') {return {err:'blocklive thinks you are logged out'}}
  const connection = new WebSocket("wss://clouddata.scratch.mit.edu");
 
  let setAndClose = new Promise((res) => {
    try{

      connection.onerror = function (error) {
        console.error('WebSocket error:', error);
        connection.close();
        res({err:error});
      };

    connection.onopen = async () => {
      connection.send(
        JSON.stringify({ method: "handshake", project_id: AUTH_PROJECTID, user }) + "\n");
      await new Promise((r) => setTimeout(r, 100));
      connection.send(
        JSON.stringify({
          value: value.toString(),
          name: "☁ verify",
          method: "set",
          project_id: AUTH_PROJECTID,
          user,
        }) + "\n"
      );
      connection.close();
      res({ok:true});
      return {ok:true};
    };
  } catch(e) {res({err:e})}
  })
  return await setAndClose
}


async function setCloudTempCode(code, projectInfo) {
  let response = await setCloudVar(code, projectInfo);
  if(response.err instanceof Error) {response.err = response.err.stack}
  return response;
}


// observe login

const targetNode = document.querySelector(".registrationLink")?.parentNode?.parentNode;

if (targetNode) { // only add the listener on the logged out page
  // Options for the observer (which mutations to observe)
  const config = { attributes: true, childList: true, subtree: true };

  // Callback function to execute when mutations are observed
  const callback = (mutationList, observer) => {
    for (const mutation of mutationList) {
      if (mutation.addedNodes?.[0]?.classList.contains('account-nav')) {
        console.log('bl login detected')
        askVerify()
      }
    }
  };

  // Create an observer instance linked to the callback function
  const observer = new MutationObserver(callback);

  // Start observing the target node for configured mutations
  observer.observe(targetNode, config);
}