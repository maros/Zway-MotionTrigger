/*** MotionTrigger Z-Way HA module *******************************************

Version: 1.0.0
(c) Maroš Kollár, 2015
-----------------------------------------------------------------------------
Author: maros@k-1.com <maros@k-1.com>
Description:
    Trigger lights by security/motion sensors

******************************************************************************/

function MotionTrigger (id, controller) {
    // Call superconstructor first (AutomationModule)
    MotionTrigger.super_.call(this, id, controller);
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
    this.vDev = this.controller.devices.create({
        deviceId: "MotionTrigger_" + this.id,
        defaults: {
            metrics: {
                probeTitle: 'controller',
                level: 'off',
                title: langFile.title,
                icon: "/ZAutomation/api/v1/load/modulemedia/MotionTrigger/icon_off.png"
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
            if (command === 'off') {
                self.triggered = false;
            }
            this.set("metrics:level", command);
            this.set("metrics:icon", "/ZAutomation/api/v1/load/modulemedia/MotionTrigger/icon_"+command+".png");
        },
        moduleId: this.id
    });
    
    this.timeout = undefined;
    this.triggered = false;
    
    setTimeout(_.bind(self.initCallback,self),10000);
};

MotionTrigger.prototype.initCallback = function() {
    var self = this;
    self.callbacks = [];
    
    _.each(self.config.securitySensors,function(deviceId) {
        var device  = self.controller.devices.get(deviceId);
        if (typeof(device) !== 'undefined') {
            var callback = _.bind(self.triggerSensor,self);
            self.callbacks[deviceId] = callback;
            device.on('change:metrics:level',callback);
        }
    });
};

MotionTrigger.prototype.stop = function() {
    var self = this;
    
    _.each(self.callbacks,function(callback) {
        device.off('change:metrics:level',callback);
    });
    
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

MotionTrigger.prototype.triggerSensor = function(sensor) {
    var self = this;
    
    // Check trigger device on
    if (self.vDev.get('metrics:level') !== 'on') {
        return;
    }
    
    // Reset timeouts if any
    self.resetTimeout();
    
    // Check security device status
    var sensors = false;
    _.each(self.config.securitySensors,function(deviceId) {
        var device = self.controller.devices.get(deviceId);
        var level = device.get("metrics:level");
        if (level === 'on') {
            sensors = true;
        }
    });
    
    
    // Triggered sensor
    if (sensors === true) {
        // Check trigger lights on
        var lights = false;
        _.each([self.config.lights,self.config.extraLights],function(list) {
            _.each(list,function(deviceId) {
                var device = self.controller.devices.get(deviceId);
                var level = device.get("metrics:level");
                if (device.get('deviceType') === 'switchBinary') {
                    if (level === 'on') {
                        lights = true;
                    }
                } else if (device.get('deviceType') === 'switchMultilevel') {
                    if (level > 0) {
                        lights = true;
                    }
                } else {
                    console.error('[MotionTrigger] Unspported device type '+device.get('deviceType'));
                    return;
                }
            });
        });
        
        // Check extra sensors
        var check = true;
        _.each(self.config.preconditions,function(element) {
            var device = self.controller.devices.get(element.device);
            var level = device.get("metrics:level");
            if (! self.op(level,element.testOperator,element.testValue)) {
                check = false;
            }
        });
        
        console.log('[MotionTrigger] Triggered security sensor (preconditions: '+check+', running: '+lights+')');
        
        // Trigger light
        if (check === true && lights === false) {
            self.switchDevices(true);
        }
    // Untriggered sensor
    } else if (sensors === false) {
        if (self.triggered === true) {
            if (self.config.duration > 0) {
                self.timeout = setTimeout(
                    _.bind(self.switchDevices,self,false),
                    (parseInt(self.config.duration) * 1000)
                );
            } else {
                self.switchDevices(false);
            }
        }
    }
};

MotionTrigger.prototype.switchDevices = function(mode) {
    var self = this;
    
    var state = self.vDev.get('metrics:level');
    if (state === 'on' && mode === true) {
        self.vDev.set("metrics:icon", "/ZAutomation/api/v1/load/modulemedia/MotionTrigger/icon_triggered.png");
    } else {
        self.vDev.set("metrics:icon", "/ZAutomation/api/v1/load/modulemedia/MotionTrigger/icon_"+state+".png");
    }
    self.resetTimeout();
    self.triggered = mode;
    
    console.log('[MotionTrigger] Turining '+(mode ? 'on':'off'));
    
    _.each(self.config.lights,function(deviceId) {
        var device = self.controller.devices.get(deviceId);
        if (device.get('deviceType') === 'switchBinary') {
            device.performCommand((mode) ? 'on':'off');
        } else if (device.get('deviceType') === 'switchMultilevel') {
            var level = (mode) ? 99:0;
            device.performCommand('exact',level);
        } else {
            console.error('Unspported device type '+device.get('deviceType'));
            return;
        }
        deviceObject.set('metrics:auto',mode);
    });
};

MotionTrigger.prototype.resetTimeout = function() {
    var self = this;
    
    if (typeof(self.timeout) !== 'undefined') {
        clearTimeout(self.timeout);
        self.timeout = undefined;
    }
};

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

 