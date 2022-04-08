/* eslint-disable */
const ipcRenderer = require('electron').ipcRenderer;
const ipcMain = require('electron').ipcMain;
const isRenderer = (typeof process === 'undefined' || !process || process.type === 'renderer');
const { getGlobal } = require(`@electron/remote${isRenderer ? '' : '/main'}`);
const events = require('events');

/**
  * The main process peer connection interface
  */
let main = {
    /**
      * Register a client to the peer connection channel.
      * @param {string} client - client format: {name: "name", window: windowObj}
      */
    addClient: function (client) {
        if (!global.clients) {
            global.clients = [];
        }
        global.clients.push(client);
    },

    /**
      * Remove a client from the peer connection channel.
      * @param {string} clientName - name of the client window
      */
    removeClient: function (targetClientName) {
        if (global.clients) {
            global.clients = global.clients.filter(
                client => client.name !== targetClientName
            );
        }
    },

    /**
      * Sets the ipc listeners for messages from renderer processes
      */
    initChannel: function () {
        ipcMain.on('log', logMessage);
        ipcMain.on('relay', relayMessage);
    },

    /**
      * Disposes message relay channel
      */
    dispose: function () {
        ipcMain.removeListener('log', logMessage);
        ipcMain.removeListener('relay', relayMessage);
        global.clients = null;
    }
};

function logMessage(event, message) {
    // console.log(message);
}

function relayMessage(event, args) {
    const receiverName = args[1];
    const message = args[2];
    const targetClient = global.clients.find(eachClient => eachClient.name === receiverName);
    if (targetClient) {
        const targetWindow = targetClient.window;
        targetWindow.webContents.send(message, args);
    }
}


/**
 * Log in main process terminal
 */
function log(message) {
    ipcRenderer.send('log', message);
}

/**
  * Wrapper class for RTCPeerConnection between Electron windows
  * @param {string} windowName - name of the BrowserWindow containing the object
  */
function WindowPeerConnection (windowName) {
    this.peerConnection = new webkitRTCPeerConnection(null);
    this.windowName = windowName;
    this.remoteStream = null;
    let thisObj = this;
    let clients = getGlobal('clients');
    events.EventEmitter.call(this);
    log(thisObj.windowName + ": peer connection object");

    /**
      * RTCPeerConnection event handlers
      */
    ipcRenderer.on('offer', (event, args) => {
        const senderName = args[0];
        const data = args[3];
        const offer = JSON.parse(data);
        handleOffer(offer, senderName);
    });
    ipcRenderer.on('answer', (event, args) => {
        const data = args[3];
        const answer = JSON.parse(data);
        handleAnswer(answer);
    });
    ipcRenderer.on('candidate', (event, args) => {
        const data = args[3];
        const candidate = JSON.parse(data);
        handleCandidate(candidate);
    });
    ipcRenderer.on('end', () => {
        handleLeave();
    });

    /**
    * Sends message from main window to mircro window.
    */
    function sendMessage(receiverName, message, data) {
      let args = [];
      args[0] = thisObj.windowName;
      args[1] = receiverName;
      args[2] = message;
      args[3] = JSON.stringify(data);
      ipcRenderer.send('relay', args);
    }

    /**
      * Attaches MediaStream object to send to peers.
      */
    this.attachStream = function (stream) {
        thisObj.remoteStream = stream;
        thisObj.peerConnection.addStream(stream);
    };

    /**
      * Removes MediaStream object attached previously.
      */
    this.removeStream = function () {
        thisObj.peerConnection.removeStream(thisObj.remoteStream);
    };

    /**
      * On received remote MediaStream, dispatch an event.
      */
    this.peerConnection.onaddstream = function (event) {
        thisObj.emit('receivedStream', event.stream);
    };

    /**
      * Wrapper for receivedStream event.
      */
    this.onReceivedStream = function (callback) {
        return thisObj.on('receivedStream', callback);
    };

    /**
      * Once ice candidate created, sends to all clients registered.
      */
    this.peerConnection.onicecandidate = function(event) {
        log(thisObj.windowName + ": iceCandidate created");
        if(event.candidate !== null) {
            const newIceCandidate = event.candidate;
            clients.forEach(
                function(client) {
                    if ( client.name !== thisObj.windowName ) {
                        sendMessage(client.name, 'candidate', newIceCandidate);
                    }
                }
            );
        }
    };

    /**
      * Ice candidate connection state change event.
      */
    this.peerConnection.oniceconnectionstatechange = function(event) {
        if (thisObj.peerConnection) {
            log(thisObj.windowName + ": iceCandidateState change event: " + event.type);
        }
    };

    /**
      * Sends the local MediaStream to a registered peer.
      * @param {string} receiverName - name of the receiving BrowserWindow
      */
    this.sendStream = function (receiverName) {
        log(thisObj.windowName + ": createOffer start");

        const offerOptions = {
            offerToReceiveVideo: 1
        };
        thisObj.peerConnection.createOffer(function (offer) {
            sendMessage(
                receiverName,
                'offer',
                offer
            );

            thisObj.peerConnection.setLocalDescription(offer);
        }, function(error) {
            log(thisObj.windowName + ": Error when creating an offer " + error);
        },
            offerOptions
        );
    };

    /**
      * Sends an offer to the target peer.
      */
    function handleOffer(offer, senderName) {
        log(thisObj.windowName + ": Setting remoteDescription");
        thisObj.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        log(thisObj.windowName + ": remoteDescription set");

        //create an answer to an offer
        thisObj.peerConnection.createAnswer(function (answer) {
            log(thisObj.windowName + ": Creating answer");
            thisObj.peerConnection.setLocalDescription(answer);
            sendMessage(
                senderName,
                'answer',
                answer
            );
        }, function (error) {
            alert(thisObj.windowName + ": Error when creating an answer " + error);
        });
    }

    /**
      * Sends an answer to the target peer.
      */
    function handleAnswer(answer) {
        thisObj.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }

    /**
      * Adds ice candidate received to the RTCPeerConnection object.
      */
    function handleCandidate(candidate) {
        thisObj.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }

    /**
      * Close connection and nullify handlers.
      */
    function handleLeave() {
        thisObj.peerConection.close();
        thisObj.peerConnection.onicecandidate = null;
        thisObj.peerConnection.onaddstream = null;
    }
}

WindowPeerConnection.prototype.__proto__ = events.EventEmitter.prototype;

module.exports.main = main;
module.exports.WindowPeerConnection = WindowPeerConnection;
