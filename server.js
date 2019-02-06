express = require('express'); 
app = express();
server = require('http').createServer(app);
io = require('socket.io').listen(server);

// get the port number from the arguments otherwise use default 80. 	
//var port = parseInt(process.argv[2], 10) || 80;
var port = process.env.PORT || 80;

// you can pass through valid admins for the dodgy boot system - see 'bootcurrent' below
var adminIPs = (process.argv[3] || '0').split(',').join();

console.log('starting server on port', port); 

//start the webserver on specified port
server.listen(port); 
//tell the server that ./public/ contains the static webpages
app.use(express.static(__dirname+'/public')); 


// The default amount of time that you get to send 
// a message (in mils)
var sendDuration = 30000; 

var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; 

// list of receivers (ie raspberry pis
var receivers = []; 
// list of senders (ie browsers)
var senders = []; 

// the socket client object for the browser currently sending the message
var activeSender = null; 
// the time that client was made active
var activeSenderStartTime = 0; 

// queue of clients waiting to send messages
var queue = []; 
// time that the queue will update
var queueShiftTime = 0; 
// the time we last got a message (letter from the active sender)
var lastMessageTime = 0; 

// a flag that is set whenever something changes that we need to tell 
// all the clients about
var statusHasChanged = true;

// to save the letters for the log!
var recordedMessage = ""; 
// an array that stores which lights are on. This is for some of the 
var lightsState = []; 

// amount of time with no data sent before we tell the sender we're moving on
var timeoutTime = 5000;
// the length of time the client gets before we actually move on
var kickOffWarningTime = 5000;  

// an object that gives us unique user names based on characters in the show
var nameGenerator = new NameGenerator(); 

setInterval(update, 1000);

function update() { 
	
	var now = Date.now(); 
	
	// if no one currently in control and there's a queue, then give control 
	// to first person in queue
	if((activeSender==null) && (queue.length>0) ) {
		setActiveSender(queue.shift()); 
		statusHasChanged = true; 
	}
	
	if(activeSender!=null) { 			
		// if there have been no messages for 5 seconds (timeout)
		if(now-lastMessageTime>timeoutTime){
			
			// and we haven't already moved the queueShiftTime forward
			if(queueShiftTime > now+kickOffWarningTime) { 
				// move the queueShiftTime forward!
				queueShiftTime = now+kickOffWarningTime;
				statusHasChanged = true; 
			}
		
		// otherwise if we have had messages and the queueShiftTime has 
		// been reduced because of inactivity, then reset it back where it
		// should be	
		} else if(queueShiftTime!= activeSenderStartTime+sendDuration) { 
			queueShiftTime = activeSenderStartTime+sendDuration;
			statusHasChanged = true; 
		}
	
	}

	// if we're ready to move on then take 
	// control away and give it to the next person in the queue.
	if(now>queueShiftTime) { 
		if(queue.length>0) {
			setActiveSender(queue.shift()); 
		} else { 
			removeActiveSender(); 
		}
	}
	
	// if anything has changed, best let everyone know!
	if(statusHasChanged) {
		sendStatus();
		statusHasChanged  = false;  
	}
}
function setActiveSender(socket) { 
	
	//console.log('setActiveSender ', socket); 
	if(activeSender == socket) return;

	removeActiveSender(); 
		
	activeSender = socket; 

	if(!activeSender) return; 

	//console.log('giving control to ', activeSender.name); 
	activeSender.emit('control', true);
	
	activeSenderStartTime = activeSender.startTime = Date.now(); 
	queueShiftTime = activeSenderStartTime+sendDuration;
	lastMessageTime = activeSenderStartTime; 
	
	activeSender.messageCount  = 0 ; 

	//console.log(activeSender, activeSender==null);
	//console.log('giving control to ', activeSender.name); 
	
	
	for(var room in activeSender.rooms) { 
		if(room!=activeSender.id) io.sockets.to(room).emit('resetletters'); 
	}
	lightsState = []; 
	recordedMessage = ""; 
	statusHasChanged = true; 
}

function removeActiveSender() { 
	
	if(activeSender!=null) { 
		activeSender.emit('control', false); 
		//console.log('removing control from ', activeSender.name); 
		activeSender = null; 
		console.log("------ " + recordedMessage);
		statusHasChanged=true;
	}
}


function getStatusObject() { 
	var status = {}; 

	// activeSenderName - 
	// who is currently in control? 
	status.activeSenderName = activeSender?activeSender.name:""; 
	
	// list of names in the queue (never longer than 20, even 
	// if there are more in the queue)
	var queueArray = []; 
	for (var i = 0; i<queue.length && i<=20; i++) { 
		queueArray.push(queue[i].name); 
	} 
	status.queue = queueArray; 
	status.queueLength = queue.length; 
	
	// queueShiftTime - 
	// what time do we change senders
	status.queueShiftTime = queueShiftTime; 
	status.timeout = (Date.now()-lastMessageTime>timeoutTime); 
	
	// number of senders
	status.senderCount = senders.length; 
	// number of receivers 
	status.receiverCount = receivers.length; 
	
	return status; 	
}
function sendStatus() { 
	//console.log("send status"); 
	io.sockets.to("default").emit('status', getStatusObject()); 
}

io.sockets.on('connection', function (socket) { //gets called whenever a client connects
	
	var ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address.address;
	console.log('connected ', ip);
	
	socket.messageCount=0;
	socket.startTime = 0;  
		
	// if we get a message of type 'register' then... 
	socket.on('register', function (data) { 
		//console.log('register', data);
		if(socket.registered) {
			console.log('client already registered!'); 
			return; 
		}
		socket.registered = true;
		
		// in future there will be separate rooms... 
		if((!checkRegisterData(data)) || (data.room!="default")) {
			killClient(socket); 
			return;
		} 
		
		socket.room = data.room; 
		socket.join(data.room); 
		
		socket.name = nameGenerator.getNewName(); 
		
		if(data.type=='sender') { 
			
			senders.push(socket); 
			socket.type = 'sender'; 
			console.log ("senders : "+senders.length, "receivers : "+receivers.length);
			// send out confirmation that the socket has registered
			socket.emit('registered', { name: socket.name, time:Date.now() });
			
			//setTimeout(function() {socket.emit('reload', 'http://seb.ly');}, 5000); 
		} else if(data.type=='receiver') { 
			receivers.push(socket); 
			socket.type = 'receiver';
			
			console.log ("new receiver : ", receivers.length);
			
			// send out confirmation that the socket has registered
			socket.emit('registered', { name: socket.name });
		} 
		
		statusHasChanged = true; 
		
		// to get all rooms : 
		//console.log(io.rooms);

	});
	
	socket.on('letter', function (data) { 
		if(activeSender!=socket) {
			//console.log('warning - control message from unauthorised sender'); 
			return;
		}
		
		// Validation! If the client is being naughty then boot them off! 
		if((!checkValidLetterMessage(data)) || (!checkMessageRate(socket))) {
			console.log('invalid', data);
			killClient(socket); 
			return; 
		}
		
		// send the  message out to all other clients in the same room
		// I'm sure there's a better way to do this but it's for futureproofing
		// when there is maybe the room system set up. 
		for(var room in socket.rooms) { 
			if(room!=socket.id) io.sockets.to(room).emit('letter', data); 
		}
		
		lastMessageTime = Date.now(); 
		// add the letter to the recordedMessage for the logs
		if(data.type=="on") recordedMessage+=data.letter; 
		// and keep track of which lights are on
		lightsState[letters.indexOf(data.letter)] = (data.type=="on")?1:0; 
			
	});
	
	socket.on('mouse', function (data) { 
		if(activeSender!=socket) {
			//console.log('warning - control message from unauthorised sender'); 
			return;
		}
		
		if((!checkValidMouseMessage(data)) || (!checkMessageRate(socket))) {
		//if((data.letter.length>1) || (letters.indexOf(data.letter)==-1)) {
			console.log('invalid mouse', data);
			killClient(socket); 
			return; 
		}
		
		// send the  message out to all other clients in the same room
		// note that mouse messages don't go to the receivers (raspberry pis)
		for(var i = 0; i<senders.length; i++) { 
			var sender = senders[i]; 
			if(sender!=socket) { 
				sender.emit('mouse', data); 
			}
		}

	});
	

	
	socket.on('joinqueue', function (data) { 
		if(queue.indexOf(socket)==-1) queue.push(socket); 
		statusHasChanged = true; 
		socket.emit('queuejoined', queue.length); 
		// force update so socket doesn't have to wait
		update(); 
	});
	socket.on('leavequeue', function (data) { 
		if(removeElementFromArray(socket, queue)) statusHasChanged = true;;  
		socket.emit('queueleft', queue.length); 
	});
	socket.on('stopsending', function (data) { 
		if(socket == activeSender) { 
			removeActiveSender(); 
		}
	});
	
	
	// temporary system for booting malicious users, should only work for requests
	// from verified admin IP addresses passed in as a parameter
	
	socket.on('bootcurrent', function(data) { 
		var sourceaddress = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address.address); 
		var currentaddress = (activeSender.handshake.headers['x-forwarded-for'] || activeSender.handshake.address.address);
		
		if(adminIPs.indexOf(sourceaddress)>-1) {
			var bootee = activeSender; 
			removeActiveSender(); 
			bootee.disconnect(); 
			console.log("booted", currentaddress);
			console.log("by address", sourceaddress);
				
			
		}
	});
	

	socket.on('disconnect', function (data) { 
		//console.log('disconnected '+socket); 
		
		if(socket==activeSender) { 
			removeActiveSender(); 
		}
		
		removeElementFromArray(socket, receivers); 
		removeElementFromArray(socket, senders); 
		nameGenerator.releaseName(socket.name);
		if(removeElementFromArray(socket, queue)) statusHasChanged = true; ; 

		if(activeSender ==socket) { 
			activeSender = null; 
		}

	});


	


});

// VALIDATION FUNCTIONS! FUN TIMES! 

function checkRegisterData(data) { 
	if(!data.hasOwnProperty('room')) return false; 
	if(!data.hasOwnProperty('type')) return false; 
	if(!((data.type=='sender') || (data.type=='receiver'))) return false; 
	return true;
}

function checkValidLetterMessage(data) { 
	if(!data) return false; 
	if(getLetterCount()>12) return false; 
	if(!data.hasOwnProperty('letter')) return false; 
	if(!data.hasOwnProperty('type')) return false; 
	if(!data.hasOwnProperty('time')) return false;
	if((data.letter.length!=1) || (letters.indexOf(data.letter)==-1)) return false; 
	if(!((data.type=='on') || (data.type=='off'))) return false; 
	return true;
}

function getLetterCount() { 
	var c = 0; 
	for(var i = 0; i<lightsState.length; i++) { 
		if(lightsState[i]) c++; 
	}
	return c; 
}

function checkMessageRate(socket) { 
	
	socket.messageCount++; 
	var sendingDuration = (Date.now()-socket.startTime)
	var rate =  socket.messageCount / sendingDuration  ; 
	//console.log("rate", rate); 

	if((rate>0.08) && (sendingDuration>100)){ 
		console.log("message rate exceeded : ", rate, socket.messageCount, Date.now()-socket.startTime);
		return false; 
	} else {
		return true; 
	}	
}
function checkValidMouseMessage(data) { 
	if(!data.hasOwnProperty('x')) return false; 
	if(!data.hasOwnProperty('y')) return false;
	if(!isNumeric(data.x)) return false; 
	if(!isNumeric(data.y)) return false; 
	return true;  
}
function isNumeric(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}
function killClient(socket) { 
	console.log('kill', socket.connected); 
	if(socket && (socket.connected)) { 
		if(socket == activeSender) {
			removeActiveSender(); 
		}
		socket.disconnect(); 
	}
}

function removeElementFromArray(element, array) { 
	var index = array.indexOf(element); 
	if(index>-1) { 
		array.splice(index, 1);
		return true;  
	} else {
		return false; 
	}
	
}

function NameGenerator() { 
	var names = ["eleven", "lucas", "barb", "chiefhopper", "nancy", "billy", "karen", "dustin", "max", "joyce",  "jonathan", "will", "mike", "docbrenner" ]; 
	var usedNames = [];
	
	this.getNewName = function () { 

		var num = 0; 
		while(1) {
			for(var i = 0; i<names.length; i++) { 
				var name = names[i]; 
				if(num>0) name=name+num; 
				if(usedNames.indexOf(name)==-1) { 
					usedNames.push(name); 
					return name; 
				}
			}
			num++; 
		}


		
	}
	
	this.releaseName = function(name) { 
		removeElementFromArray(name, usedNames); 
	}
		
}
