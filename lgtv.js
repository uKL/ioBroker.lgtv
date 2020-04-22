/* jshint -W097 */
/* jshint strict:false */
/* global require */
/* global RRule */
/* global __dirname */
/* jslint node: true */
'use strict';

const utils = require('@iobroker/adapter-core');
let adapter;
const LGTV = require('lgtv2');
const wol = require('wol');
const fs = require('fs');

let hostUrl
let isConnect = false;
let lgtvobj, clientKey, volume, oldvolume;
let keyfile = 'lgtvkeyfile';
let renewTimeout = null;
let healthIntervall= null
let curApp= "";

function startAdapter(options){
    options = options || {};
    Object.assign(options, {
        systemConfig: true,
        name:         "lgtv",
        stateChange:  (id, state) => {
            if (id && state && !state.ack){
                id = id.substring(adapter.namespace.length + 1);
                let vals, dx, dy;
                if(~state.val.toString().indexOf(',')){
                    vals = state.val.toString().split(',');
                    dx = parseInt(vals[0]);
                    dy = parseInt(vals[1]);
                }
                adapter.log.debug('State change "' + id + '" - VALUE: ' + state.val);
                switch (id) {
                    case 'states.popup':
                        adapter.log.debug('Sending popup message "' + state.val + '" to WebOS TV: ' + adapter.config.ip);
                        sendCommand('ssap://system.notifications/createToast', {message: state.val}, (err, val) => {
                            if (!err) adapter.setState('states.popup', state.val, true);
                        });
                        break;
                    case 'states.turnOff':
                        adapter.log.debug('Sending turn OFF command to WebOS TV: ' + adapter.config.ip);
                        if (adapter.config.power){
                            sendCommand('button', {name: 'power'}, (err, val) => {
                                if (!err) adapter.setState('states.turnOff', state.val, true);
                            });
                        } else {
                            adapter.getState(adapter.namespace + '.states.on', (err, tv_on) => {
                                if (err) { adapter.log.debug('Error getting "on" state ' + err); return; }
                                if (!tv_on.val) {
                                    adapter.log.debug('TV is already off');
                                    adapter.setState('states.turnOff', state.val, true);
                                    return;
                                }

                                sendCommand('ssap://system/turnOff', (err, val) => {
                                    if (!err && val.returnValue === true) {
                                        adapter.setState('states.turnOff', state.val, true);
                                        adapter.setState('states.on', false, true);
                                    }
                                });
                            });
                        }
                        break;

                    case 'states.power':
                        if (!state.val){
                            adapter.log.debug('Sending turn OFF command to WebOS TV: ' + adapter.config.ip);
                            if (adapter.config.power){
                                sendCommand('button', {name: 'power'}, (err, val) => {
                                    if (!err) adapter.setState('states.power', state.val, true);
                                });
                            } else {
                                adapter.getState(adapter.namespace + '.states.on', (err, tv_on) => {
                                    if (err) { adapter.log.debug('Error getting "on" state ' + err); return; }
                                    if (!tv_on.val) {
                                        adapter.log.debug('TV is already off');
                                        adapter.setState('states.power', state.val, true);
                                        return;
                                    }

                                    sendCommand('ssap://system/turnOff', (err, val) => {
                                        if (!err && val.returnValue === true) {
                                            adapter.setState('states.power', state.val, true);
                                            adapter.setState('states.on', false, true);
                                        }
                                    });
                                });
                            }
                        } else {
                            adapter.getState(adapter.namespace + '.states.mac', (err, state) => {
                                adapter.log.debug('GetState mac: ' + JSON.stringify(state));
                                if (state){
                                    wol.wake(state.val, (err, res) => {
                                        if (!err) adapter.log.debug('Send WOL to MAC: {' + state.val + '} OK');
                                    });
                                } else {
                                    adapter.log.error('Error get MAC address TV. Please turn on the TV manually first!');
                                }
                            });
                        }
                        break;

                    case 'states.mute':
                        adapter.log.debug('Sending mute ' + state.val + ' command to WebOS TV: ' + adapter.config.ip);
                        sendCommand('ssap://audio/setMute', {mute: state.val}, (err, val) => {
                            if (!err) adapter.setState('states.mute', state.val, true);
                        });
                        break;

                    case 'states.volume':
                        adapter.log.debug('Sending volume change ' + state.val + ' command to WebOS TV: ' + adapter.config.ip);
                        oldvolume = volume;
                        SetVolume(state.val);
                        break;

                    case 'states.volumeUp':
                        adapter.log.debug('Sending volumeUp ' + state.val + ' command to WebOS TV: ' + adapter.config.ip);
                        sendCommand('ssap://audio/volumeUp', null, (err, val) => {
                            if (!err) adapter.setState('states.volumeUp', !!state.val, true);
                        });
                        break;

                    case 'states.volumeDown':
                        adapter.log.debug('Sending volumeDown ' + state.val + ' command to WebOS TV: ' + adapter.config.ip);
                        sendCommand('ssap://audio/volumeDown', null, (err, val) => {
                            if (!err) adapter.setState('states.volumeDown', !!state.val, true);
                        });
                        break;

                    case 'states.channel':
                        adapter.log.debug('Sending switch to channel ' + state.val + ' command to WebOS TV: ' + adapter.config.ip);
                        sendCommand('ssap://tv/openChannel', {channelNumber: state.val.toString()}, (err, val) => {
                            if (!err)
                                adapter.setState('states.channel', state.val, true);
                            else
                                adapter.log.debug('Error in switching to channel: ' + err);
                        });
                        break;

                    case 'states.channelUp':
                        adapter.log.debug('Sending channelUp ' + state.val + ' command to WebOS TV: ' + adapter.config.ip);
                        sendCommand('ssap://tv/channelUp', null, (err, val) => {
                            if (!err) adapter.setState('states.channelUp', !!state.val, true);
                        });
                        break;

                    case 'states.channelDown':
                        adapter.log.debug('Sending channelDown ' + state.val + ' command to WebOS TV: ' + adapter.config.ip);
                        sendCommand('ssap://tv/channelDown', null, (err, val) => {
                            if (!err) adapter.setState('states.channelDown', !!state.val, true);
                        });
                        break;


                    case 'states.mediaPlay':
                        adapter.log.debug('Sending mediaPlay ' + state.val + ' command to WebOS TV: ' + adapter.config.ip);
                        sendCommand('ssap://media.controls/play', null, (err, val) => {
                            if (!err) adapter.setState('states.mediaPlay', !!state.val, true);
                        });
                        break;

                    case 'states.mediaPause':
                        adapter.log.debug('Sending mediaPause ' + state.val + ' command to WebOS TV: ' + adapter.config.ip);
                        sendCommand('ssap://media.controls/pause', null, (err, val) => {
                            if (!err) adapter.setState('states.mediaPause', !!state.val, true);
                        });
                        break;

                    case 'states.openURL':
                        if (!state.val)
                            return adapter.setState('states.openURL', "", true);
                        adapter.log.debug('Sending open ' + state.val + ' command to WebOS TV: ' + adapter.config.ip);
                        sendCommand('ssap://system.launcher/open', {target: state.val}, (err, val) => {
                            if (!err) adapter.setState('states.openURL', state.val, true);
                        });
                        break;

                    case 'states.mediaStop':
                        adapter.log.debug('Sending mediaStop ' + state.val + ' command to WebOS TV: ' + adapter.config.ip);
                        sendCommand('ssap://media.controls/stop', null, (err, val) => {
                            if (!err) adapter.setState('states.mediaStop', !!state.val, true);
                        });
                        break;

                    case 'states.mediaFastForward':
                        adapter.log.debug('Sending mediaFastForward ' + state.val + ' command to WebOS TV: ' + adapter.config.ip);
                        sendCommand('ssap://media.controls/fastForward', null, (err, val) => {
                            if (!err) adapter.setState('states.mediaFastForward', !!state.val, true);
                        });
                        break;

                    case 'states.mediaRewind':
                        adapter.log.debug('Sending mediaRewind ' + state.val + ' command to WebOS TV: ' + adapter.config.ip);
                        sendCommand('ssap://media.controls/rewind', null, (err, val) => {
                            if (!err) adapter.setState('states.mediaRewind', !!state.val, true);
                        });
                        break;

                    case 'states.3Dmode':
                        adapter.log.debug('Sending 3Dmode ' + state.val + ' command to WebOS TV: ' + adapter.config.ip);
                        switch (state.val) {
                            case true:
                                sendCommand('ssap://com.webos.service.tv.display/set3DOn', null, (err, val) => {
                                    if (!err) adapter.setState('states.3Dmode', !!state.val, true);
                                });
                                break;

                            case false:
                                sendCommand('ssap://com.webos.service.tv.display/set3DOff', null, (err, val) => {
                                    if (!err) adapter.setState('states.3Dmode', !!state.val, true);
                                });
                                break;
                        }
                        break;

                    case 'states.launch':
                        adapter.log.debug('Sending launch command ' + state.val + ' to WebOS TV: ' + adapter.config.ip);
                        switch (state.val) {
                            case 'livetv':
                                adapter.log.debug('Switching to LiveTV on WebOS TV: ' + adapter.config.ip);
                                sendCommand('ssap://system.launcher/launch', {id: "com.webos.app.livetv"}, (err, val) => {
                                    if (!err) adapter.setState('states.launch', state.val, true);
                                });
                                break;
                            case 'smartshare':
                                adapter.log.debug('Switching to SmartShare App on WebOS TV: ' + adapter.config.ip);
                                sendCommand('ssap://system.launcher/launch', {id: "com.webos.app.smartshare"}, (err, val) => {
                                    if (!err) adapter.setState('states.launch', state.val, true);
                                });
                                break;
                            case 'tvuserguide':
                                adapter.log.debug('Switching to TV Userguide App on WebOS TV: ' + adapter.config.ip);
                                sendCommand('ssap://system.launcher/launch', {id: "com.webos.app.tvuserguide"}, (err, val) => {
                                    if (!err) adapter.setState('states.launch', state.val, true);
                                });
                                break;
                            case 'netflix':
                                adapter.log.debug('Switching to Netflix App on WebOS TV: ' + adapter.config.ip);
                                sendCommand('ssap://system.launcher/launch', {id: "netflix"}, (err, val) => {
                                    if (!err) adapter.setState('states.launch', state.val, true);
                                });
                                break;
                            case 'youtube':
                                adapter.log.debug('Switching to Youtube App on WebOS TV: ' + adapter.config.ip);
                                sendCommand('ssap://system.launcher/launch', {id: "youtube.leanback.v4"}, (err, val) => {
                                    if (!err) adapter.setState('states.launch', state.val, true);
                                });
                                break;
                            case 'prime':
                                adapter.log.debug('Switching to Amazon Prime App on WebOS TV: ' + adapter.config.ip);
                                sendCommand('ssap://system.launcher/launch', {id: "lovefilm.de"}, (err, val) => {
                                    if (!err) adapter.setState('states.launch', state.val, true);
                                });
                                break;
                            case 'amazon':
                                adapter.log.debug('Switching to Amazon Prime App on WebOS TV: ' + adapter.config.ip);
                                sendCommand('ssap://system.launcher/launch', {id: "amazon"}, (err, val) => {
                                    if (!err) adapter.setState('states.launch', state.val, true);
                                });
                                break;
                            default:
                                //state.val = '"' + state.val + '"';
                                adapter.log.debug('Opening app ' + state.val + ' on WebOS TV: ' + adapter.config.ip);
                                sendCommand('ssap://system.launcher/launch', {id: state.val}, (err, val) => {
                                    if (!err)
                                        adapter.setState('states.launch', state.val, true);
                                    else adapter.log.debug('Error opening app ' + state.val + ' on WebOS TV: ' + adapter.config.ip);
                                });

                                break;
                        }
                        break;

                    case 'states.input':
                        adapter.log.debug('Sending switch to input "' + state.val + '" command to WebOS TV: ' + adapter.config.ip);
                        sendCommand('ssap://tv/switchInput', {inputId: state.val}, (err, val) => {
                            if (!err && val.returnValue) adapter.setState('states.input', state.val, true);
                        });

                        break;

                    case 'states.raw':
                        adapter.log.debug('Sending RAW command api "' + state.val + '" to WebOS TV: ' + adapter.config.ip);
                        try {
                            const obj = JSON.parse(state.val);
                            sendCommand(obj.url, obj.cmd, (err, val) => {
                                if (!err){
                                    adapter.log.debug('Response RAW  command api ' + JSON.stringify(val));
                                    adapter.setState('states.raw', JSON.stringify(val), true);
                                }
                            });
                        } catch (e) {
                            adapter.log.error('Parse error RAW command api - ' + e);
                        }
                        break;

                    case 'states.youtube':
                        let uri = state.val;
                        if (!uri)
                            return adapter.setState('states.youtube', "", true);
                        if (!~uri.indexOf('http')){
                            uri = 'https://www.youtube.com/watch?v=' + uri;
                        }
                        sendCommand('ssap://system.launcher/launch', {id: 'youtube.leanback.v4', contentId: uri}, (err, val) => {
                            if (!err) adapter.setState('states.youtube', state.val, true);
                        });
                        break;

                    case 'states.drag':
                        // The event type is 'move' for both moves and drags.
                        if(dx && dy){
                            sendCommand('move', {dx: dx, dy: dy, drag: vals[2] === 'drag' ? 1 :0}, (err, val) => {
                                if (!err) adapter.setState(id, state.val, true);
                            });
                        }
                        break;

                    case 'states.scroll':
                        if(dx && dy){
                            sendCommand('scroll', {dx: dx, dy: dy}, (err, val) => {
                                if (!err) adapter.setState(id, state.val, true);
                            });
                        }
                        break;

                    case 'states.click':
                        sendCommand('click', {}, (err, val) => {
                            if (!err) adapter.setState(id, state.val, true);
                        });
                        break;

                    case 'states.soundOutput':
                        sendCommand('ssap://com.webos.service.apiadapter/audio/changeSoundOutput', {output: state.val}, (err, val) => {
                            if (!err) adapter.setState(id, state.val, true);
                        });
                        break;

                    default:
                        if (~id.indexOf('remote')){
                            adapter.log.debug('State change "' + id + '" - VALUE: ' + JSON.stringify(state));
                            const ids = id.split(".");
                            const key = ids[ids.length - 1].toString().toUpperCase();
                            sendCommand('button', {name: key}, (err, val) => {
                                if (!err) adapter.setState(id, state.val, true); // ?
                            });
                        }
                        break;
                }
            }
        },
        unload:       (callback) => {
            renewTimeout && clearTimeout(renewTimeout);
            lgtvobj && lgtvobj.disconnect();
            isConnect= false;
            checkConnection(true);
            callback();
        },
        ready:        () => {
            main();
        }
    });

    adapter = new utils.Adapter(options);

    return adapter;
}

function connect(cb){
    hostUrl = 'ws://' + adapter.config.ip + ':3000' 
    let reconnect = adapter.config.reconnect
    if (!reconnect || isNaN(reconnect) || reconnect < 5000)
        reconnect= 5000;
    lgtvobj = new LGTV({
        url:       hostUrl,
        timeout:   adapter.config.timeout,
        reconnect: reconnect,
        clientKey: clientKey,
        saveKey:   (key, cb) => {
            fs.writeFile(keyfile, key, cb)
        }
    });
    lgtvobj.on('connecting', (host) => {
        adapter.log.debug('Connecting to WebOS TV: ' + host);
        checkConnection();
    });

    lgtvobj.on('close', (e) => {
        adapter.log.debug('Connection closed: ' + e);
        checkConnection();
    });

    lgtvobj.on('prompt', () => {
        adapter.log.debug('Waiting for pairing confirmation on WebOS TV ' + adapter.config.ip);
    });

    lgtvobj.on('error', (error) => {
        adapter.log.debug('Error on connecting or sending command to WebOS TV: ' + error);
    });

    lgtvobj.on('connect', (error, response) => {
        adapter.log.debug('WebOS TV Connected');
        isConnect = true;
        adapter.setStateChanged('info.connection', true, true);
        lgtvobj.subscribe('ssap://audio/getVolume', (err, res) => {
            adapter.log.debug('audio/getVolume: ' + JSON.stringify(res));
            if (~res.changed.indexOf('volume')){
                volume = parseInt(res.volume);
                adapter.setState('states.volume', volume, true);
            }
            if (~res.changed.indexOf('muted')){
                adapter.setState('states.mute', res.muted, true);
            }
        });
        lgtvobj.request('ssap://tv/getExternalInputList', (err, res) => {
            if(!err && res.devices){
                adapter.extendObject('states.input', {common: {states: null}}, () => {
                    adapter.extendObject('states.input', {common: {states: inputList(res.devices)}});
                });
            }
        });
        lgtvobj.request('ssap://com.webos.applicationManager/listLaunchPoints', (err, res) => {
            if(!err && res.launchPoints){
                adapter.extendObject('states.launch', {common: {states: null}}, () => {
                    adapter.extendObject('states.launch', {common: {states: launchList(res.launchPoints)}});
                });
            }
        });
        lgtvobj.subscribe('ssap://tv/getCurrentChannel', (err, res) => {
            if (!err && res){
                adapter.log.debug('tv/getCurrentChannel: ' + JSON.stringify(res));
                adapter.setState('states.channel', res.channelNumber || '', true);
                adapter.setState('states.channelId', res.channelId ||'', true);
            } else {
                adapter.log.debug('ERROR on getCurrentChannel: ' + err);
            }
        });
        lgtvobj.subscribe('ssap://com.webos.applicationManager/getForegroundAppInfo',(err, res) => {
            if (!err && res){
                adapter.log.debug('DEBUGGING getForegroundAppInfo: ' + JSON.stringify(res));
                curApp = res.appId || '';
                if (!curApp){ // some TV send empty app first, if they switched on
                    setTimeout(function(){
                        if (!curApp){ // curApp is not set in meantime
                            if (healthIntervall && !adapter.config.healthIntervall){
                                clearInterval(healthIntervall);
                                healthIntervall = false // TV works fine,  healthIntervall is not longer nessessary
                                adapter.log.info("detect poweroff event, polling not longer nessesary. if you have problems, check settings")
                            }
                            checkCurApp(); // so TV is off
                        }
                    },1500) 
                } else
                    checkCurApp();
             } else {
                adapter.log.debug('ERROR on get input and app: ' + err);
            }
        });
        lgtvobj.subscribe('ssap://com.webos.service.apiadapter/audio/getSoundOutput',(err, res) => {
            if (!err && res){
                adapter.log.debug('audio/getSoundOutput: ' + JSON.stringify(res));
                adapter.setState('states.soundOutput', res.soundOutput || '', true);
            } else {
                adapter.log.debug('ERROR on getSoundOutput: ' + err);
            }
        });
        sendCommand('ssap://api/getServiceList', null, (err, val) => {
            if (!err) adapter.log.debug('Service list: ' + JSON.stringify(val));
        });
        sendCommand('ssap://com.webos.service.update/getCurrentSWInformation', null, (err, val) => {
            if (!err){
                adapter.log.debug('getCurrentSWInformation: ' + JSON.stringify(val));
                adapter.setState('states.mac', adapter.config.mac ? adapter.config.mac :val.device_id, true);
            }
        });
        sendCommand('ssap://system/getSystemInfo', null, (err, val) => {
            if (!err){
                adapter.log.debug('getSystemInfo: ' + JSON.stringify(val));
                adapter.setState('states.model', val.modelName, true);
            }
        });
        cb && cb();
    });
 
}

const launchList = (arr) => {
    let obj = {"livetv": "Live TV"};
    arr.forEach(function(o, i) {
        obj[o.id] = o.title;
    });
    return obj;
};

const inputList = (arr) => {
    let obj = {};
    arr.forEach(function(o, i) {
        obj[o.id] = o.label + ' (' + o.id + ')';
    });
    return obj;
};
function checkConnection(secondCheck){
    if (secondCheck){
        if (!isConnect){
            adapter.setStateChanged('info.connection', false, true);
            healthIntervall && clearInterval(healthIntervall);
            checkCurApp(true);
        }
    } else {
        isConnect= false;
        setTimeout(checkConnection,10000,true); //check, if isConnect is changed in 10 sec
    }
}

function checkCurApp(powerOff){
    if (powerOff){
        curApp= "";
    }
    let isTVon= !!curApp;
    adapter.log.debug(curApp ? "cur app is " + curApp : "TV is off")
    adapter.setStateChanged('states.currentApp', curApp, true);
    let inp = curApp.split(".").pop()
    if (inp.indexOf('hdmi') == 0){
        adapter.setStateChanged('states.input', "HDMI_" + inp[4], true);
        adapter.setStateChanged('states.launch', "", true);
    } else {
        adapter.setStateChanged('states.input', "", true);
        adapter.setStateChanged('states.launch', inp, true);
    }
    adapter.setStateChanged('states.power', isTVon, true);
    adapter.setStateChanged('states.on', isTVon, true, function(err,stateID, notChanged) {
        if (!notChanged){ // state was changed
            renewTimeout && clearTimeout(renewTimeout); // avoid toggeling
            if (isTVon){ // if tv is now switched on ...
                adapter.log.debug("renew connection in one minute for stable subscriptions...")
                renewTimeout = setTimeout(() => {
                    lgtvobj.disconnect();
                    setTimeout(lgtvobj.connect,500,hostUrl);
                    if (healthIntervall !== false){
                        healthIntervall= setInterval(sendCommand, adapter.config.healthIntervall || 60000, 'ssap://com.webos.service.tv.time/getCurrentTime', null, (err, val) => {
                            adapter.log.debug("check TV connection: " + (err || "ok"))
                            if (err)
                                checkCurApp(true)
                        })
                    }
                }, 60000);
            } //else if (healthIntervall)
                //clearInterval(healthIntervall);
        }
    });
}

function sendCommand(cmd, options, cb){
    if (isConnect){
        sendPacket(cmd, options, (_error, response) => {
            cb && cb(_error, response);
        });
    }
}

function sendPacket(cmd, options, cb){
    if (~cmd.indexOf('ssap:') || ~cmd.indexOf('com.')){
        lgtvobj.request(cmd, options, (_error, response) => {
            if (_error){
                adapter.log.debug('ERROR! Response from TV: ' + (response ? JSON.stringify(response) :_error));
            }
            cb && cb(_error, response);
        });
    } else {
        lgtvobj.getSocket('ssap://com.webos.service.networkinput/getPointerInputSocket', (err, sock) => {
            if (!err){
                sock.send(cmd, options);
            }
        });
    }
}

function SetVolume(val){
    if (val >= volume + 5){
        let vol = oldvolume;
        const interval = setInterval(() => {
            vol = vol + 2;
            if (vol >= val){
                vol = val;
                clearInterval(interval);
            }
            sendCommand('ssap://audio/setVolume', {volume: vol}, (err, resp) => {
                if (!err){
                }
            });
        }, 500);
    } else {
        sendCommand('ssap://audio/setVolume', {volume: val}, (err, resp) => {
            if (!err){
            }
        });
    }
}

function main(){
    if (adapter.config.ip){
        adapter.log.info('Ready. Configured WebOS TV IP: ' + adapter.config.ip);
        adapter.subscribeStates('*');
        let dir = utils.controllerDir + '/' + adapter.systemConfig.dataDir + adapter.namespace.replace('.', '_') + '/';
        keyfile = dir + keyfile;
        adapter.log.debug('adapter.config = ' + JSON.stringify(adapter.config));
        if (adapter.config.healthIntervall < 1)
            healthIntervall = false;
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        fs.readFile(keyfile, (err, data) => {
            if (!err){
                try {
                    clientKey = data.toString();
                } catch (err) {
                    fs.writeFile(keyfile, '', (err) => {
                        if (err) adapter.log.error('writeFile ERROR = ' + JSON.stringify(err));
                    });
                }
            } else {
                fs.writeFile(keyfile, '', (err) => {
                    if (err) adapter.log.error('writeFile ERROR = ' + JSON.stringify(err));
                });
            }
            connect();
        });
    } else {
        adapter.log.error('No configure IP address');
    }
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent){
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
