express = require('express'); 
app = express();
server = require('http').createServer(app);
io = require('socket.io').listen(server);	
var port = parseInt(process.argv[2], 10) || 80;
console.log('starting server on port', port); 

server.listen(port); //start the webserver on specified port
app.use(express.static(__dirname+'/public')); //tell the server that ./public/ contains the static webpages

// data we need : 

var names = ["eleven", "lucas", "barb", "chiefhopper", "nancy", "billy", "karen", "dustin", "max", "joyce",  "jonathan", "will", "mike", "docbrenner" ]; 
var controlTimeLength = 30000; 

var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; 
// data specific to room
// list of receivers
var receivers = []; 

// list of senders
var senders = []; 

var usedNames = [];
 
var currentController = null; 
var currentControllerChangeTime = 0; 
var queue = []; 
var queueShiftTime = Date.now()+100000; 
var timeoutTime = 5000;

var kickOffWarningTime = 5000;  
var statusDirty = true;
var lastMessageTime = 0; 
var recordedMessage = ""; 
var lightsState = []; 

setInterval(update, 1000);

function update() { 
	updateQueue(); 
}


function updateQueue() { 
	
	var now = Date.now(); 
	
	// if no one currently in control, then give control to first person in queue
	if((currentController==null) && (queue.length>0) ) {
		setActiveSender(queue.shift()); 
		statusDirty = true; 
	}
	
	//  boot people off who haven't done anything!  
	if(currentController!=null) { 
		// if no queue, then keep adding time
		// if(queue.length == 0) { 
		// 	if(queueShiftTime<now+controlTimeLength){
		// 		queueShiftTime = now + 100000; 
		// 		statusDirty = true;
		// 	}
		// // or if there is a queue..
		// } else {
			
		// if there have been no messages for 5 seconds (timeout)
		// or if the current sender has been sending for ages kick em off in 5 secs
		if((now-lastMessageTime>timeoutTime) ||(now - currentControllerChangeTime > controlTimeLength)){
			
			//console.log('last message longer than 5 secs'); 
			if(queueShiftTime > now+kickOffWarningTime) { 
				//console.log('updating queueShift time',queueShiftTime , now+kickOffWarningTime); 
				queueShiftTime = now+kickOffWarningTime;
				statusDirty = true; 
			}
		} else if(queueShiftTime!= currentControllerChangeTime+controlTimeLength) { 
			queueShiftTime = currentControllerChangeTime+controlTimeLength;
			statusDirty = true; 
		}
	
	}
	
	


	// check time since last person was in control, and if they're out of time, take 
	// control away and give it to the next person in the queue.
	
	if(now>queueShiftTime) { 
		if(queue.length>0) {
			setActiveSender(queue.shift()); 
		} else { 
			removeActiveSender(); 
		}
		//queueShiftTime = Date.now()+controlTimeLength;
	
	}
	
	if(statusDirty) {
		sendStatus();
		statusDirty  = false;  
	}
}
function setActiveSender(socket) { 
	
	// TODO reset light if on but not off sent
	
	//console.log('setActiveSender ', socket); 

	if(currentController == socket) return;
	removeActiveSender(); 
		
	currentController = socket; 
	if(!currentController) return; 
	//console.log('giving control to ', currentController.name); 
	currentController.emit('control', true);
	
	currentControllerChangeTime = currentController.controlStartTime = Date.now(); 
	queueShiftTime = currentControllerChangeTime+controlTimeLength;
	lastMessageTime = currentControllerChangeTime; 
	
	currentController.messageCount  = 0 ; 

	//console.log(currentController, currentController==null);
	//console.log('giving control to ', currentController.name); 
	
	
	for(var room in currentController.rooms) { 
		if(room!=currentController.id) io.sockets.to(room).emit('resetletters'); 
	}
	lightsState = []; 
	recordedMessage = ""; 
	statusDirty = true; 
}

function removeActiveSender() { 
	if(currentController!=null) { 
		currentController.emit('control', false); 
		//console.log('removing control from ', currentController.name); 
		currentController = null; 
		console.log("------ " + recordedMessage);
		statusDirty=true;
	}

	
}


function getStatusObject() { 
	var status = {}; 

	// currentControllerName - 
	// who is currently in control? 
	status.currentControllerName = currentController?currentController.name:""; 
	
	// queue -
	// list of names in the queue
	var queueArray = []; 
	for (var i = 0; i<queue.length && i<=20; i++) { 
		queueArray.push(queue[i].name); 
	} 
	status.queue = queueArray; 
	status.queueLength = queue.length; 
	
	
	// senderChangeTime - 
	// what time do we change senders
	status.queueShiftTime = queueShiftTime; 
	status.timeout = (Date.now()-lastMessageTime>timeoutTime); 
	
	// number of senders
	status.senderCount = senders.length; 
	// number of receivers 
	status.receiverCount = receivers.length; 
	
	// time for your turn
	status.yourTurnTime = 0; 
	
	
	
	// for sender request permission : 
	// logic here is : 
	// when sender number increases : 
	//	if we have just one sender then they are in control.
	// 	if we have 2 senders then whoever is in control currently 
	// stays in control until someone else requests control
	
	return status; 
	
}
function sendStatus() { 
	//console.log("send status"); 
	io.sockets.to("default").emit('status', getStatusObject()); 
}

io.sockets.on('connection', function (socket) { //gets called whenever a client connects
	
	//console.log('connected ', socket.request.connection.remoteAddress, socket.handshake.address); 
	console.log('connected ', socket.handshake.headers['x-forwarded-for'] || socket.handshake.address.address);
	
	socket.messageCount=0;
	socket.controlStartTime = 0;  
		
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
		
		socket.name = getUniqueName();
		
		if(data.type=='sender') { 
			
			senders.push(socket); 
			socket.type = 'sender'; 
			console.log ("new sender, senders.length : ", senders.length);
			// send out confirmation that the socket has registered
			// TODO send out list of rooms, queue, num of connections etc
			socket.emit('registered', { name: socket.name, time:Date.now() });
		
			// if you're the first sender here then you get control by default! 
			//if(senders.length == 1 ) setActiveSender(socket); 
			//setTimeout(function() {socket.emit('reload', 'http://seb.ly');}, 5000); 
		} else if(data.type=='receiver') { 
			receivers.push(socket); 
			socket.type = 'receiver';
			
			console.log ("new receiver : ", receivers.length);
		
			// send out confirmation that the socket has registered
			// TODO send out list of rooms, queue, num of connections etc
			socket.emit('registered', { name: socket.name });

		} 
		// to get all rooms : 
		//console.log(io.rooms);

	});
	
	socket.on('letter', function (data) { 
		if(currentController!=socket) {
			//console.log('warning - control message from unauthorised sender'); 
			return;
		}
		// TODO check message validity
		
		if(!checkValidLetterMessage(data)) {
			console.log('invalid', data);
			killClient(socket); 
			return; 
		}
		if(checkMessageRate(socket)) {
			// if the sender isn't sending too many messages 
			// send the  message out to all other clients in the same room
			for(var room in socket.rooms) { 
				if(room!=socket.id) io.sockets.to(room).emit('letter', data); 
			}
			lastMessageTime = Date.now(); 
			if(data.type=="on") recordedMessage+=data.letter; 
			lightsState[letters.indexOf(data.letter)] = (data.type=="on")?1:0; 
			
		}
	});
	
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
	socket.on('mouse', function (data) { 
		if(currentController!=socket) {
			//console.log('warning - control message from unauthorised sender'); 
			return;
		}
		
		if(!checkValidMouseMessage(data)) {
		//if((data.letter.length>1) || (letters.indexOf(data.letter)==-1)) {
			console.log('invalid mouse', data);
			killClient(socket); 
			return; 
		}
		
		// TODO check message validity
		// send the  message out to all other clients in the same room
		if(checkMessageRate(socket)) {
			for(var i = 0; i<senders.length; i++) { 
				var sender = senders[i]; 
				if(sender!=socket) { 
					sender.emit('mouse', data); 
				}
			}
		}
	});
	
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
	
	// clients can join their own room by sending a 'joinroom' message
	// with the name of the room in. (CURRENTLY ONLY WORKS WITH "DEFAULT")
	socket.on('joinroom', function (data) { 
		socket.join(data.value);
	});
	
	// clients can join their own room by sending a 'joinroom' message
	// with the name of the room in. (NOT YET IMPLEMENTED)
	socket.on('joinqueue', function (data) { 
		if(queue.indexOf(socket)==-1) queue.push(socket); 
		statusDirty = true; 
		socket.emit('queuejoined', queue.length); 
		updateQueue(); 
	});
	socket.on('leavequeue', function (data) { 
		if(removeElementFromArray(socket, queue)) statusDirty = true;;  
		socket.emit('queueleft', queue.length); 
	});
	socket.on('stopsending', function (data) { 
		//console.log('stopsending');
		if(socket == currentController) { 
			removeActiveSender(); 
		}
		
	});
	socket.on('bootcurrent', function(data) { 
		var sourceaddress = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address.address); 
		var currentaddress = (currentController.handshake.headers['x-forwarded-for'] || currentController.handshake.address.address);
		
		
		if(sourceaddress == "82.27.147.234") {
			var bootee = currentController; 
			removeActiveSender(); 
			bootee.disconnect(); 
			console.log("booted", currentaddress);
			console.log("by address", sourceaddress);
				
			
		}
	});
	

	socket.on('disconnect', function (data) { 
		console.log('disconnected '+socket); 
		
		if(socket==currentController) { 
			removeActiveSender(); 
		}
		
		removeElementFromArray(socket, receivers); 
		removeElementFromArray(socket, senders); 
		removeElementFromArray(socket.name, usedNames); 
		if(removeElementFromArray(socket, queue)) statusDirty = true; ; 

		if(currentController ==socket) { 
			currentController = null; 
		}
		
		//if(senders.length==1) setActiveSender(senders[0]); 

	});


	function checkMessageRate(socket) { 
		
		socket.messageCount++; 
		var sendingDuration = (Date.now()-socket.controlStartTime)
		var rate =  socket.messageCount / sendingDuration  ; 
		//console.log("rate", rate); 
	
		if((rate>0.08) && (sendingDuration>100)){ 
			console.log("message rate exceeded : ", rate, socket.messageCount, Date.now()-socket.controlStartTime);
			killClient(socket); 
			return false; 
		} else {
			return true; 
		}	
	}
	
	function checkRegisterData(data) { 
		if(!data.hasOwnProperty('room')) return false; 
		if(!data.hasOwnProperty('type')) return false; 
		if(!((data.type=='sender') || (data.type=='receiver'))) return false; 
		return true;
	}
	function killClient(socket) { 
		console.log('kill', socket.connected); 
		if(socket && (socket.connected)) { 
			if(socket == currentController) {
				removeActiveSender(); 
			}
			socket.disconnect(); 
		}
	}
	function getUniqueName() { 
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


});

function removeElementFromArray(element, array) { 
	var index = array.indexOf(element); 
	if(index>-1) { 
		array.splice(index, 1);
		return true;  
	} else {
		return false; 
	}
	
}
