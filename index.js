/*** MotionTrigger Z-Way HA module *******************************************

Version: 1.03
(c) Maroš Kollár, 2015
-----------------------------------------------------------------------------
Author: Maroš Kollár <maros@k-1.com>
Description:
    Trigger lights by security/motion sensors

******************************************************************************/

/* jshint evil:true */

function MotionTrigger (id, controller) {
    // Call superconstructor first (AutomationModule)
    MotionTrigger.super_.call(this, id, controller);
    
    this.timeout        = undefined;
    this.callbackEvent  = undefined;
    this.callbackSensor = undefined;
    this.interval       = undefined;
    this.dimmerLevel    = undefined;
}

inherits(MotionTrigger, BaseModule);

_module = MotionTrigger;

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

MotionTrigger.prototype.init = function (config) {
    MotionTrigger.super_.prototype.init.call(this, config);
    var self = this;
    
    // Create vdev
    self.vDev = this.controller.devices.create({
        deviceId: "MotionTrigger_" + self.id,
        defaults: {
            metrics: {
                level: 'off',
                title: self.langFile.title,
                icon: "/ZAutomation/api/v1/load/modulemedia/MotionTrigger/icon_off.png",
                triggered: false,
                timeout: null
            }
        },
        overlay: {
            probeType: 'MotionTriggerController',
            deviceType: 'switchBinary'
        },
        handler: function(command, args) {
            if (command !== 'on'
                && command !== 'off') {
                return;
            }
            this.set("metrics:level", command);
            this.set("metrics:icon", "/ZAutomation/api/v1/load/modulemedia/MotionTrigger/icon_"+command+".png");
            if (command === 'off') {
                self.resetInterval();
                self.resetTimeout();
                // Turn off if triggered
                if (this.get("metrics:triggered")) {
                    self.log('Switching off all triggered devices');
                    self.switchDevice(false);
                }
            } else if (command === 'on') {
                // Check the condition and trigger immediately
                self.handleChange('on');
            }
        },
        moduleId: self.id
    });
    
    if (typeof(self.config.dimmerLevel) === 'string'
        && self.config.dimmerLevel !== '') {
        self.dimmerLevel = self.config.dimmerLevel;
        if (self.dimmerLevel.match('^\s*\d+\s*$')) {
            self.dimmerLevel = parseInt(self.dimmerLevel,10);
        }
    }
    
    self.callbackSensor = _.bind(self.handleSensor,self);
    self.callbackEvent  = _.bind(self.handleEvent,self);
    self.callbackLight  = _.bind(self.handleLight,self);
    
    self.controller.on('light.off',self.callbackEvent);
    setTimeout(_.bind(self.initCallback,self),10000);
};

MotionTrigger.prototype.initCallback = function() {
    var self = this;

    // Correctly init after restart
    var timeoutAbs = self.vDev.get('metrics:timeout');
    if (typeof(timeoutAbs) === 'number') {
        self.log('Restart timeout');
        var timeoutRel = timeoutAbs - new Date().getTime();
        if (timeoutRel <= 0) {
            self.switchDevice(false);
        } else {
            self.timeout = setTimeout(
                _.bind(self.switchDevice,self,false),
                timeoutRel
            );
        }
    } else if (self.vDev.get('metrics:triggered')) {
        self.log('Triggered');
        self.handleChange('on');
    }
    
    self.processDeviceList(self.config.securitySensors,function(deviceObject) {
        deviceObject.on('modify:metrics:level',self.callbackSensor);
    });
    
    self.processDeviceList(self.config.lights,function(deviceObject) {
        deviceObject.on('modify:metrics:level',self.callbackLight);
    });
};

MotionTrigger.prototype.stop = function() {
    var self = this;
    
    self.processDeviceList(self.config.securitySensors,function(deviceObject) {
        deviceObject.off('modify:metrics:level',self.callbackSensor);
    });
    
    self.processDeviceList(self.config.lights,function(deviceObject) {
        deviceObject.off('modify:metrics:level',self.callbackLight);
    });
    
    self.controller.off('light.off',self.callbackEvent);
    
    self.callbackEvent  = undefined;
    self.callbackSensor = undefined;
    self.callbackLight  = undefined;
    
    self.resetInterval();
    self.resetTimeout();
    
    if (self.vDev) {
        self.controller.devices.remove(self.vDev.id);
        self.vDev = undefined;
    }
    
    MotionTrigger.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

MotionTrigger.prototype.handleLight = function(vDev) {
    var self = this;
    
    var triggered = self.vDev.get('metrics:triggered');
    if (!triggered) {
        return;
    }
    
    if (typeof(self.lock) !== 'undefined'
        && self.lock.cleared === false) {
        self.log('Has lock');
        return;
    }
    
    var lightsOn = false;
    self.processDeviceList(self.config.lights,function(deviceObject) {
        if (deviceObject.get('metrics:level') === 'on') {
            lightsOn = true;
        }
    });
    
    if (lightsOn === false) {
        self.switchDevice(false);
    }
};

MotionTrigger.prototype.handleEvent = function(event) {
    var self = this;
    
    if (event.id === self.id) {
        return;
    }
    
    setTimeout(
        _.bind(self.handleChange,self,'on'),
        500
    );
};

MotionTrigger.prototype.handleSensor = function(vDev) {
    var self = this;
    
    self.handleChange(vDev.get('metrics:level'),vDev);
};

MotionTrigger.prototype.handleChange = function(mode,vDev) {
    var self = this;
    
    // Check trigger device on
    if (self.vDev.get('metrics:level') !== 'on') {
        return;
    }
    
    // Check if actual change happened
    if (typeof(vDev) === 'object'
        && vDev instanceof VirtualDevice) {
        self.log('Handle change to '+mode+' from '+vDev.id);
    } else {
        self.log('Handle change to '+mode);
    }
    
    // Check security device status
    var sensors     = self.checkDevice(self.config.securitySensors);
    var triggered   = self.vDev.get('metrics:triggered');
    
    // Triggered sensor
    if (sensors === true 
        && mode === 'on') {
        // Check trigger lights on
        var lights          = self.checkDevice(self.config.lights);
        var extraLights     = self.checkDevice(self.config.extraLights);
        // Check extra sensors
        var precondition    = self.checkPrecondition();
        
        self.log('Triggered security sensor (preconditions: '+precondition+', lights: '+lights+', extra: '+extraLights+', triggered:'+triggered+')');
        
        // Trigger light
        if (precondition === true 
            && lights === false
            && extraLights === false) {
            self.resetTimeout();
            self.switchDevice(true);
        // Retrigger light
        } else if (triggered === true && 
            (! self.config.recheckPreconditions || precondition === true)) {
            // Reset timeouts
            self.resetTimeout();
            self.vDev.set("metrics:icon", "/ZAutomation/api/v1/load/modulemedia/MotionTrigger/icon_triggered.png");
        }
    // Untriggered sensor
    } else if (sensors === false 
        && mode === 'off'
        && triggered === true
        && typeof(self.timeout) === 'undefined') {
        self.untriggerDevice();
    }
};

MotionTrigger.prototype.checkInterval = function() {
    var self = this;
    
    // Check trigger device on, triggered and no timeout
    if (self.vDev.get('metrics:level') !== 'on'
        || self.vDev.get('metrics:triggered') === false
        || typeof(self.timeout) !== 'undefined') {
        return;
    }
    
    var check = self.checkPrecondition();
    self.log('Recheck interval '+check);
    if (! check) {
        self.untriggerDevice();
    }
};

MotionTrigger.prototype.untriggerDevice = function() {
    var self = this;
    
    self.resetInterval();
    self.resetTimeout();
    
    if (self.config.timeout > 0) {
        self.log('Untriggered security sensor. Starting timeout');
        var timeoutRel = parseInt(self.config.timeout,10) * 1000;
        var timeoutAbs = new Date().getTime() + timeoutRel;
        self.vDev.set("metrics:icon", "/ZAutomation/api/v1/load/modulemedia/MotionTrigger/icon_timeout.png");
        self.timeout = setTimeout(
            _.bind(self.switchDevice,self,false),
            timeoutRel
        );
        self.vDev.set('metrics:timeout',timeoutAbs);
    } else {
        self.log('Untriggered security sensor. Turning off');
        self.switchDevice(false);
    }
};

// Helper method to check any device in list of devices if on
MotionTrigger.prototype.checkDevice = function(devices) {
    var self = this;
    
    var status = false;
    self.processDeviceList(devices,function(deviceObject) {
        var type    = deviceObject.get('deviceType') ;
        var level   = deviceObject.get("metrics:level");
        if (type === 'switchBinary'
            || type === 'sensorBinary') {
            if (level === 'on') {
                status = true;
            }
        } else if (type === 'switchMultilevel'
            || type === 'sensorMulitlevel') {
            if (level > 0) {
                status = true;
            }
        } else {
            console.error('[MotionTrigger] Unsupported device type '+deviceObject.get('deviceType'));
            return;
        }
    });
    
    return status;
};

// Helper to check preconditions
MotionTrigger.prototype.checkPrecondition = function() {
    var self = this;
    
    var check = true;
    _.each(self.config.preconditions,function(element) {
        if (check === false) return;
        var deviceObject = self.controller.devices.get(element.device);
        if (deviceObject === null) return;
        var level = deviceObject.get("metrics:level");
        if (! self.op(level,element.testOperator,element.testValue)) {
            check = false;
        }
    });
    
    if (check === true) {
        var timeCheck;
        _.each(self.config.timeActive,function(element) {
            if (timeCheck !== true) {
                timeCheck = self.checkPeriod(element.start,element.end);
            }
        });
        if (timeCheck === false) check = false;
    }
    
    return check;
};

MotionTrigger.prototype.switchDevice = function(mode) {
    var self = this;
    
    var level = self.vDev.get('metrics:level');
    var dimmerLevel = 99;
    if (level === 'on' && mode === true) {
        self.vDev.set("metrics:icon", "/ZAutomation/api/v1/load/modulemedia/MotionTrigger/icon_triggered.png");
        
        self.lock = new Timeout(self,function() {},1000*5);
        
        if (self.config.recheckPreconditions) {
            self.resetInterval();
            self.interval = setInterval(
                _.bind(self.checkInterval,self),
                (1000 * 30)
            );
        }
        
        if (typeof(self.dimmerLevel) === 'number') {
            dimmerLevel = self.dimmerLevel;
        } else if (typeof(self.dimmerLevel) === 'string') {
            try {
                dimmerLevel = parseInt(eval(self.dimmerLevel),10);
            } catch (e) {
                console.error('[MotionTrigger] Could not calculate dimmer level: '+e);
                dimmerLevel = 99;
            }
        }
        if (dimmerLevel > 99) {
            dimmerLevel = 99;
        }
    } else {
        self.resetInterval();
        self.vDev.set("metrics:icon", "/ZAutomation/api/v1/load/modulemedia/MotionTrigger/icon_"+level+".png");
    }
    
    self.resetTimeout();
    self.vDev.set("metrics:triggered",mode);
    
    self.log('Turning '+(mode ? 'on':'off'));
    
    self.processDeviceList(self.config.lights,function(deviceObject) {
        if (deviceObject.get('deviceType') === 'switchBinary') {
            deviceObject.performCommand((mode) ? 'on':'off');
        } else if (deviceObject.get('deviceType') === 'switchMultilevel') {
            var level = (mode) ? dimmerLevel:0;
            if (level ===  0) {
                deviceObject.performCommand('off');
            } else {
                deviceObject.performCommand('exact',{ level: level });
            }
        } else {
            console.error('[MotionTrigger] Unspported device type '+deviceObject.get('deviceType'));
            return;
        }
        deviceObject.set('metrics:auto',mode);
    });
    
    self.controller.emit('light.'+(mode ? 'on':'off'),{ 
        id:         self.id,
        title:      self.vDev.get('metrics:title'),
        location:   self.vDev.get('metrics:location'),
        mode:       mode
    });
};

// Reset interval helper
MotionTrigger.prototype.resetInterval = function() {
    var self = this;
    
    if (typeof(self.interval) === 'undefined') {
        clearInterval(self.interval);
        self.interval = undefined;
    }
};

// Reset timeout helper
MotionTrigger.prototype.resetTimeout = function() {
    var self = this;
    
    if (typeof(self.timeout) !== 'undefined') {
        clearTimeout(self.timeout);
        self.timeout = undefined;
    }
    self.vDev.set('metrics:timeout',null);
};

// Condition comparison helper
MotionTrigger.prototype.op = function (dval, op, val) {
    if (op === "=") {
        return dval === val;
    } else if (op === "!=") {
        return dval !== val;
    } else if (op === ">") {
        return dval > val;
    } else if (op === "<") {
        return dval < val;
    } else if (op === ">=") {
        return dval >= val;
    } else if (op === "<=") {
        return dval <= val;
    }
        
    return null; // error!!  
};

