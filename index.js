/*** MotionTrigger Z-Way HA module *******************************************

Version: 1.02
(c) Maroš Kollár, 2015
-----------------------------------------------------------------------------
Author: Maroš Kollár <maros@k-1.com>
Description:
    Trigger lights by security/motion sensors

******************************************************************************/

function MotionTrigger (id, controller) {
    // Call superconstructor first (AutomationModule)
    MotionTrigger.super_.call(this, id, controller);
    
    this.timeout    = undefined;
    this.callback   = undefined;
    this.interval   = undefined;
    this.dimmerLevel= undefined;
}

inherits(MotionTrigger, AutomationModule);

_module = MotionTrigger;

// ----------------------------------------------------------------------------
// --- Module instance initialized
// ----------------------------------------------------------------------------

MotionTrigger.prototype.init = function (config) {
    MotionTrigger.super_.prototype.init.call(this, config);
    var self = this;
    
    var langFile = self.controller.loadModuleLang("MotionTrigger");
    
    // Create vdev
    self.vDev = this.controller.devices.create({
        deviceId: "MotionTrigger_" + self.id,
        defaults: {
            metrics: {
                probeTitle: 'controller',
                level: 'off',
                title: langFile.title,
                icon: "/ZAutomation/api/v1/load/modulemedia/MotionTrigger/icon_off.png",
                triggered: false
            }
        },
        overlay: {
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
                // TODO Should we turn off triggered devices?
                this.set("metrics:triggered", false);
            } else if (command === 'on') {
                // Check the condition and tigger imediately
                self.triggerSensor();
            }
        },
        moduleId: self.id
    });
    
    if (typeof(self.config.dimmerLevel) === 'string'
        && self.config.dimmerLevel != '') {
        self.dimmerLevel = self.config.dimmerLevel;
        if (self.dimmerLevel.match('^\s*\d+\s*$')) {
            self.dimmerLevel = parseInt(self.dimmerLevel);
        }
    }
    
    self.callback = _.bind(self.triggerSensor,self);
    setTimeout(_.bind(self.initCallback,self),10000);
};

MotionTrigger.prototype.initCallback = function() {
    var self = this;

    _.each(self.config.securitySensors,function(deviceId) {
        var deviceObject  = self.controller.devices.get(deviceId);
        if (deviceObject === null) {
            console.error('[MotionTrigger] Device not found '+deviceId);
        } else {
            deviceObject.on('change:metrics:level',self.callback);
        }
        /*
        self.controller.devices.on(
            deviceId, 
            'change:metrics:level', 
            self.callback
        );
        */
    });
};

MotionTrigger.prototype.stop = function() {
    var self = this;
    
    _.each(self.config.securitySensors,function(deviceId) {
        var deviceObject  = self.controller.devices.get(deviceId);
        if (deviceObject !== null) {
            deviceObject.off('change:metrics:level',self.callback);
        }
    });
    
    self.callback = undefined;
    
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

MotionTrigger.prototype.triggerSensor = function() {
    var self = this;
    
    // Check trigger device on
    if (self.vDev.get('metrics:level') !== 'on') {
        return;
    }
    
    // Reset timeouts & intervals if any
    self.resetTimeout();
    self.resetInterval();
    
    // Check security device status
    var sensors = self.checkDevice(self.config.securitySensors);
    
    // Triggered sensor
    if (sensors === true) {
        // Check trigger lights on
        var lights      = self.checkDevice(self.config.lights);
        var extraLights = self.checkDevice(self.config.extraLights);
        var triggered   = self.vDev.get('metrics:triggered');
        
        // Check extra sensors
        var precondition = self.checkPrecondition();
        
        console.log('[MotionTrigger] Triggered security sensor (preconditions: '+precondition+', lights: '+lights+', extra: '+extraLights+')');
        
        // Trigger light
        if (precondition === true 
            && lights === false
            && extraLights == false) {
            self.switchDevice(true);
        // Retrigger light
        } else if (triggered === true && (! self.config.recheckPreconditions || precondition === true)) {
            self.vDev.set("metrics:icon", "/ZAutomation/api/v1/load/modulemedia/MotionTrigger/icon_triggered.png");
        }
    // Untriggered sensor
    } else if (sensors === false) {
        if (self.vDev.get("metrics:triggered") === true) {
            self.untriggerDevice();
        }
    }
};

MotionTrigger.prototype.checkInterval = function() {
    var self = this;
    
    // Check trigger device on, triggered and no timeout
    if (self.vDev.get('metrics:level') !== 'on'
        || self.vDev.get('metrics:triggered') == false
        || typeof(self.timeout) !== 'undefined') {
        return;
    }
    
    var check = self.checkPrecondition();
    console.log('[DeviceMove] Recheck interval '+check);
    if (! check) {
        self.untriggerDevice();
    }
};

MotionTrigger.prototype.untriggerDevice = function() {
    var self = this;
    
    console.log('[MotionTrigger] Untriggered security sensor');

    if (self.config.timeout > 0) {
        self.vDev.set("metrics:icon", "/ZAutomation/api/v1/load/modulemedia/MotionTrigger/icon_timeout.png");
        self.timeout = setTimeout(
            _.bind(self.switchDevice,self,false),
            (parseInt(self.config.timeout) * 1000)
        );
    } else {
        self.switchDevice(false);
    }
};

// Helper method to check any device in list of devices if on
MotionTrigger.prototype.checkDevice = function(devices) {
    var self = this;
    
    var status = false;
    _.each(devices,function(deviceId) {
        var deviceObject = self.controller.devices.get(deviceId);
        if (deviceObject === null) {
            return;
        }
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
            console.error('[MotionTrigger] Unspported device type '+deviceObject.get('deviceType'));
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
        var deviceObject = self.controller.devices.get(element.device);
        if (deviceObject === null) {
            return;
        }
        var level = deviceObject.get("metrics:level");
        if (! self.op(level,element.testOperator,element.testValue)) {
            check = false;
        }
    });
    
    return check;
}

MotionTrigger.prototype.switchDevice = function(mode) {
    var self = this;
    
    var state = self.vDev.get('metrics:level');
    var dimmerLevel = 255;
    if (state === 'on' && mode === true) {
        self.vDev.set("metrics:icon", "/ZAutomation/api/v1/load/modulemedia/MotionTrigger/icon_triggered.png");
        
        if (self.config.recheckPreconditions) {
            self.interval = setInterval(
                _.bind(self.checkInterval,self),
                (1000 * 30)
            );
        }
        
        if (typeof(self.dimmerLevel) === 'number') {
            dimmerLevel = self.dimmerLevel;
        } else if (typeof(self.dimmerLevel) === 'string') {
            try {
                dimmerLevel = parseInt(eval(self.dimmerLevel));
            } catch (e) {
                console.error('[MotionTrigger] Could not calculate dimmer level: '+e);
                dimmerLevel = 255;
            }
        }
        if (dimmerLevel > 255) {
            dimmerLevel = 255;
        }
    } else {
        self.resetInterval();
        self.vDev.set("metrics:icon", "/ZAutomation/api/v1/load/modulemedia/MotionTrigger/icon_"+state+".png");
    }
    self.resetTimeout();
    self.vDev.set("metrics:triggered",mode);
    
    console.log('[MotionTrigger] Turining '+(mode ? 'on':'off'));
    
    _.each(self.config.lights,function(deviceId) {
        var deviceObject = self.controller.devices.get(deviceId);
        if (deviceObject === null) {
            return;
        }
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
            console.error('[DeviceMove] Unspported device type '+deviceObject.get('deviceType'));
            return;
        }
        deviceObject.set('metrics:auto',mode);
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

 