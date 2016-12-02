express = require('express'); 
app = express();
server = require('http').createServer(app);
io = require('socket.io').listen(server);	
var port = parseInt(process.argv[2], 10) || 80;
console.log('starting server on port', port); 

server.listen(port); //start the webserver on specified port
app.use(express.static('public')); //tell the server that ./public/ contains the static webpages

// data we need : 

var names = ["hopper", "nancy", "billy", "max", "docbrenner", "jonathan", "eleven", "lucas", "will", "karen", "barb", "mike", "dustin", "joyce"]; 
var controlTimeLength = 20000; 

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
var statusDirty = true;
var recordedMessage = ""; 

setInterval(update, 1000);

function update() { 
	updateQueue(); 
}


function updateQueue() { 

	// if no one currently in control, then give control to first person in queue
	if((currentController==null) && (queue.length>0) ) {
		setActiveSender(queue.shift()); 
		statusDirty = true; 
	}
	
	var now = Date.now(); 
	// if there's no one in the queue then let the current person keep playing
	if(queue.length==0) { 
		// if there's no one in the queue then keep giving the person playing 
		queueShiftTime = now+controlTimeLength; 
		statusDirty = true; 
		// or if the current controller has been on for ages, then give them another five secs
	} else if((now - currentControllerChangeTime > controlTimeLength) && (queueShiftTime-Date.now()>3000)){ 
		queueShiftTime = Date.now()+3000; 
		statusDirty = true; 
	} 
	// check time since last person was in control, and if they're out of time, take 
	// control away and give it to the next person in the queue.
	
	// TODO boot people off who haven't done anything!  
	if(Date.now()>queueShiftTime) { 
		setActiveSender(queue.shift()); 
		queueShiftTime = Date.now()+controlTimeLength;
		statusDirty = true; 
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
	if(currentController!=null) { 
		currentController.emit('control', false); 
		console.log('removing control from ', currentController.name); 
		
	}
	console.log("------ " + recordedMessage); 
		
	currentController = socket; 
	if(!currentController) return; 
	console.log('giving control to ', currentController.name); 
	currentController.emit('control', true);
	currentController.controlStartTime = Date.now(); 
	currentController.messageCount  = 0 ; 
	
	
	
	//console.log(currentController, currentController==null);
	//console.log('giving control to ', currentController.name); 
	currentControllerChangeTime = Date.now(); 	
	
	for(var room in currentController.rooms) { 
		if(room!=currentController.id) io.sockets.to(room).emit('resetletters'); 
	}
	
	recordedMessage = ""; 
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
	//socket.emit('status', getStatusObject()); 
	io.sockets.to("default").emit('status', getStatusObject()); 
}
io.sockets.on('connection', function (socket) { //gets called whenever a client connects
	
	//console.log('connected '); 
	
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
			socket.disconnect(); 
			return;
		} 
		
		socket.room = data.room; 
		socket.join(data.room); 
		
		socket.name = getUniqueName();
		
		if(data.type=='sender') { 
			
			senders.push(socket); 
			socket.type = 'sender'; 
			console.log ("new sender, senders.length : ", senders.length, senders.length==1);
			// send out confirmation that the socket has registered
			// TODO send out list of rooms, queue, num of connections etc
			socket.emit('registered', { name: socket.name, time:Date.now() });
		
			// if you're the first sender here then you get control by default! 
			if(senders.length == 1 ) setActiveSender(socket); 
			//setTimeout(function() {socket.emit('reload', 'http://seb.ly');}, 5000); 
		} else if(data.type=='receiver') { 
			receivers.push(socket); 
			socket.type = 'receiver';
		
			// send out confirmation that the socket has registered
			// TODO send out list of rooms, queue, num of connections etc
			socket.emit('registered', { name: socket.name });
			//socket.emit('reboot'); 
		} 
		// to get all rooms : 
		//console.log(io.rooms);
		
		
		
		// send the  message out to all other clients in the same room
		// note that the socket always joins its own room, named after its own id. 
		// This nasty code is a hacky way to get send messages to the same room that
		// this socket is in. 
		// for(var room in socket.rooms){
		// 			if(room!=socket.id) io.sockets.to(room).emit('led', {value: data.value}); 
		// 		}
	});
	
	
	socket.on('letter', function (data) { 
		if(currentController!=socket) {
			//console.log('warning - control message from unauthorised sender'); 
			return;
		}
		// TODO check message validity
		
		if(!checkValidLetterMessage(data)) {
		//if((data.letter.length>1) || (letters.indexOf(data.letter)==-1)) {
			console.log('invalid', data);
			socket.disconnect(); 
			return; 
		}
		if(checkMessageRate(socket)) {
			// send the  message out to all other clients in the same room
			for(var room in socket.rooms) { 
				if(room!=socket.id) io.sockets.to(room).emit('letter', data); 
			}
			
			if(data.type=="on") recordedMessage+=data.letter; 
		}
	});
	
	function checkValidLetterMessage(data) { 
		if(!data.hasOwnProperty('letter')) return false; 
		if(!data.hasOwnProperty('type')) return false; 
		if(!data.hasOwnProperty('time')) return false;
		if((data.letter.length!=1) || (letters.indexOf(data.letter)==-1)) return false; 
		if(!((data.type=='on') || (data.type=='off'))) return false; 
		return true;
	}
	
	socket.on('mouse', function (data) { 
		if(currentController!=socket) {
			//console.log('warning - control message from unauthorised sender'); 
			return;
		}
		
		if(!checkValidMouseMessage(data)) {
		//if((data.letter.length>1) || (letters.indexOf(data.letter)==-1)) {
			console.log('invalid mouse', data);
			socket.disconnect(); 
			return; 
		}
		
		// TODO check message validity
		// send the  message out to all other clients in the same room
		if(checkMessageRate(socket)) {
			for(var room in socket.rooms) { 
				if(room!=socket.id) io.sockets.to(room).emit('mouse', data); 
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
	// with the name of the room in. 
	socket.on('joinroom', function (data) { 
		socket.join(data.value);
	});
	
	// clients can join their own room by sending a 'joinroom' message
	// with the name of the room in. 
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
	
	

	socket.on('disconnect', function (data) { 
		//console.log('disconnected '+socket); 
		
		removeElementFromArray(socket, receivers); 
		removeElementFromArray(socket, senders); 
		removeElementFromArray(socket.name, usedNames); 
		if(removeElementFromArray(socket, queue)) statusDirty = true; ; 

		if(currentController ==socket) { 
			currentController = null; 
		}
		if(senders.length==1) setActiveSender(senders[0]); 

	});


	function checkMessageRate(socket) { 
		
		socket.messageCount++; 
		var rate =  socket.messageCount / (Date.now()-socket.controlStartTime)  ; 
		//console.log("rate", rate); 
	
		if(rate>0.08) { 
			socket.disconnect(); 
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
