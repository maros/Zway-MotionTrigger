/*** MotionTrigger Z-Way HA module *******************************************

Version: 1.10
(c) Maroš Kollár, 2015-2017
-----------------------------------------------------------------------------
Author: Maroš Kollár <maros@k-1.com>
Description:
    Trigger lights by security/motion sensors

******************************************************************************/

/* jshint evil:true */

function MotionTrigger (id, controller) {
    // Call superconstructor first (AutomationModule)
    MotionTrigger.super_.call(this, id, controller);

    this.offTimeout     = undefined;
    this.delayTimeout   = undefined;
    this.callbackEvent  = undefined;
    this.callbackSensor = undefined;
    this.checkInterval  = undefined;
    this.pollInterval   = undefined;
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
                level: 'on',
                title: self.langFile.m_title,
                icon: self.imagePath+'/icon_off.png',
                triggered: false,
                offtimeout: null,
                delaytimeout: null
            }
        },
        overlay: {
            probeType: '',
            deviceType: 'switchBinary'
        },
        handler: function(command, args) {
            if (command !== 'on'
                && command !== 'off') {
                return;
            }
            this.set("metrics:level", command);
            this.set("metrics:icon", self.imagePath+'/icon_'+command+".png");
            if (command === 'off') {
                self.resetInterval();
                self.resetOffTimeout();
                // Turn off if triggered
                if (this.get("metrics:triggered")) {
                    self.log('Switching off all triggered devices');
                    self.switchDevice(false);
                }
            } else if (command === 'on') {
                // Check the condition and trigger immediately
                self.handleChange('on',this);
            }
        },
        moduleId: self.id
    });

    self.callbackSensor = _.bind(self.handleSensor,self);
    self.callbackEvent  = _.bind(self.handleEvent,self);
    self.callbackLight  = _.bind(self.handleLight,self);

    if (typeof(self.config.pollSensors) === 'number'
        && self.config.pollSensors > 0) {
        self.callbackPoll   = _.bind(self.handlePoll,self);
        self.pollInterval   = setInterval(self.callbackPoll,1000*60*self.config.pollSensors);
    }
    self.controller.on('light.off',self.callbackEvent);
    setTimeout(_.bind(self.initCallback,self),10000);
};

MotionTrigger.prototype.initCallback = function() {
    var self = this;

    // Correctly init after restart
    var offtimeout = self.vDev.get('metrics:offTime');
    var delaytimeout = self.vDev.get('metrics:delaytimeout');

    if (typeof(offtimeout) === 'number') {
        self.log('Restart off timeout');
        offtimeout -= new Date().getTime();
        if (offtimeout <= 0) {
            self.switchDevice(false);
        } else {
            self.offTimeout = setTimeout(
                _.bind(self.switchDevice,self,false),
                offtimeout
            );
        }
    } else if (typeof(delaytimeout) === 'number') {
        self.log('Restart delay timeout');
        delaytimeout -= new Date().getTime();
        if (delaytimeout <= 0) {
            self.switchDevice(true);
        } else {
            self.delayTimeout = setTimeout(
                _.bind(self.switchDevice,self,true),
                delaytimeout
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

    if (typeof(self.pollInterval) !== 'undefined') {
        clearInterval(self.pollInterval);
        self.pollInterval   = undefined;
        self.callbackPoll   = undefined;
    }

    self.callbackEvent  = undefined;
    self.callbackSensor = undefined;
    self.callbackLight  = undefined;

    self.resetInterval();
    self.resetOffTimeout();
    self.resetDelayTimeout();

    if (self.vDev) {
        self.controller.devices.remove(self.vDev.id);
        self.vDev = undefined;
    }

    MotionTrigger.super_.prototype.stop.call(this);
};

// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

MotionTrigger.prototype.handlePoll = function() {
    var self = this;

    // Check trigger device on, triggered
    if (self.vDev.get('metrics:level') !== 'on'
        || self.vDev.get('metrics:triggered') === false) {
        return;
    }

    self.processDeviceList(self.config.securitySensors,function(deviceObject) {
        deviceObject.performCommand('update');
    });
};

MotionTrigger.prototype.handleLight = function(vDev) {
    var self = this;

    // Nothing to do since at least one light is still active
    if ( self.checkDevice(self.config.lights) ) {
        return;
    }

    // Reset delay
    self.resetDelayTimeout();

    // No further processing if not triggered
    if (! self.vDev.get('metrics:triggered')) {
        return;
    }

    // Device locked
    if (typeof(self.lock) !== 'undefined'
        && self.lock.cleared === false) {
        self.log('Has lock');
        return;
    }

    // Turn off light
    self.switchDevice(false);
};

MotionTrigger.prototype.handleEvent = function(event) {
    var self = this;
    if (event.id === self.id)
        return;
    if (typeof(event.vDev) === 'undefined')
        return;
    if (event.vDev.get('metrics:location') !== self.vDev.get('metrics:location'))
        return;

    self.log("Handle event from "+event.vDev.id);
    self.log(event);
    setTimeout(
        _.bind(self.handleChange,self,'on',event.vDev),
        100
    );
};

MotionTrigger.prototype.handleSensor = function(vDev) {
    var self = this;

    self.log("Handle sensor update from "+vDev.id);
    self.handleChange(vDev.get('metrics:level'),vDev);
};

MotionTrigger.prototype.handleChange = function(mode,vDev) {
    var self = this;

    // Check trigger device on
    if (self.vDev.get('metrics:level') !== 'on') {
        self.log('Ignoring change to '+mode+': Controller off');
        return;
    // Check if actual change happened
    } else if (typeof(vDev) === 'object'
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
        // Check extra sensors
        var precondition    = self.checkPrecondition();

        self.log('Triggered motion sensor (preconditions: '+precondition+', lights: '+lights+', triggered: '+triggered+')');

        // Trigger light
        if (precondition === true
            && lights === false) {
            self.resetOffTimeout();
            // Handle delayed trigger
            if (self.config.delay
                && parseInt(self.config.delay,10) > 0) {
                if (typeof(self.delayTimeout) === 'undefined') {
                    self.log('Delayed tigger');
                    var delayRel = parseInt(self.config.delay,10) * 1000;
                    var delayAbs = new Date().getTime() + delayRel;
                    self.delayTimeout = setTimeout(
                        _.bind(self.switchDevice,self,true),
                        delayRel
                    );
                    self.vDev.set('metrics:delaytimeout',delayAbs);
                }
            } else {
                self.log('Immediate tigger');
                self.switchDevice(true);
            }
        // Retrigger light
        } else if (triggered === true &&
            (! self.config.preconditions.recheck || precondition === true)) {
            // Reset timeouts
            self.resetOffTimeout();
            self.vDev.set("metrics:icon", self.imagePath+'/icon_triggered.png');
        }
    // Untriggered sensor
    } else if (sensors === false
        && mode === 'off'
        && triggered === true
        && typeof(self.offTimeout) === 'undefined') {
        self.untriggerDevice();
    // Stop delay after sensor was untriggered
    } else if (sensors === false
        && triggered === false
        && mode === 'off') {
        self.resetDelayTimeout();
    } else {
        self.log('Ignoring. Sensor: '+sensors+' Triggered: '+triggered+' Mode: '+mode);
    }
};

MotionTrigger.prototype.handleCheck = function() {
    var self = this;

    // Check trigger device on, triggered and no timeout
    if (self.vDev.get('metrics:level') !== 'on'
        || self.vDev.get('metrics:triggered') === false
        || typeof(self.offTimeout) !== 'undefined') {
        return;
    }

    var check = self.checkPrecondition();
    if (! check) {
        self.untriggerDevice();
    }
};

MotionTrigger.prototype.untriggerDevice = function() {
    var self = this;

    self.resetInterval();
    self.resetOffTimeout();
    self.resetDelayTimeout();

    if (self.config.timeout > 0) {
        self.log('Untriggered sensor. Starting timeout');
        var timeoutRel = parseInt(self.config.timeout,10) * 1000;
        var timeoutAbs = new Date().getTime() + timeoutRel;
        self.vDev.set("metrics:icon", self.imagePath+'/icon_timeout.png');
        self.offTimeout = setTimeout(
            _.bind(self.switchDevice,self,false),
            timeoutRel
        );
        self.vDev.set('metrics:offTime',timeoutAbs);
    } else {
        self.log('Untriggered sensor. Turning off');
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

        self.log('Device '+deviceObject.get("metrics:title")+' is '+level);
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
            self.error('Unsupported device type '+deviceObject.get('deviceType'));
            return;
        }
    });

    return status;
};

// Helper to check preconditions
MotionTrigger.prototype.checkPrecondition = function() {
    var self = this;

    self.log('Calculating precondition');

    var dateNow         = new Date();
    var dayofweekNow    = dateNow.getDay().toString();
    var condition       = true;

    // Check time
    if (condition === true
        && self.config.preconditions.time.length > 0) {
        var timeCondition = false;
        _.each(self.config.preconditions.time,function(time) {
            if (timeCondition === true) {
                return;
            }

            // Check day of week if set
            if (typeof(time.dayofweek) === 'object'
                && time.dayofweek.length > 0
                && _.indexOf(time.dayofweek, dayofweekNow.toString()) === -1) {
                self.log('Day of week does not match');
                return;
            }

            if (! self.checkPeriod(time.timeFrom,time.timeTo)) {
                self.log('Time does not match');
                return;
            }

            timeCondition = true;
        });
        condition = timeCondition;
    }

    // Check binary
    _.each(self.config.preconditions.binary,function(check) {
        if (condition) {
            var device = self.controller.devices.get(check.device);
            if (! _.isNull(device)) {
                var level = device.get('metrics:level');
                if (check.value !== level) {
                    self.log('Binary does not match: '+device.id);
                    condition = false;
                }
            } else {
                self.error('Could not find device '+check.device);
            }
        }
    });

    // Check multilevel
    _.each(self.config.preconditions.multilevel,function(check) {
        if (condition) {
            var device = self.controller.devices.get(check.device);
            if (! _.isNull(device)) {
                var level = device.get('metrics:level');
                if (! self.compare(level,check.operator,check.value)) {
                    self.log('Multilevel does not match: '+device.id);
                    condition = false;
                }
            } else {
                self.error('Could not find device '+check.device);
            }
        }
    });

    return condition;
};

MotionTrigger.prototype.switchDevice = function(mode) {
    var self = this;

    var level = self.vDev.get('metrics:level');
    var dimmerLevel = 99;

    if (level === 'on' && mode === true) {
        self.vDev.set("metrics:icon", self.imagePath+'/icon_triggered.png');

        // Set 5 sec lock
        self.lock = new Timeout(self,function() {},1000*5);

        if (self.config.preconditions.recheck) {
            self.resetInterval();
            self.checkInterval = setInterval(
                _.bind(self.handleCheck,self),
                (1000 * 30)
            );
        }

        switch (self.config.dimmer.mode) {
            case 'static':
                dimmerLevel = parseInt(self.config.dimmer.static,10);
                break;
            case 'code':
                try {
                    dimmerLevel = parseInt(eval(self.config.dimmer.code),10);
                } catch (e) {
                    self.error('Could not calculate dimmer level: '+e);
                }
                break;
            case 'dynamic':
                var dimmerConfig        = self.config.dimmer.dynamic;
                var luminosityDevice    = self.controller.devices.get(dimmerConfig.luminosityDevice);
                if (luminosityDevice === null) {
                    self.error('Could not find luminosity device');
                    break;
                }
                var luminosityLevel     = luminosityDevice.get('metrics:level');
                var luminosityWindow    = (dimmerConfig.luminosityMax - dimmerConfig.luminosityMin);

                if (luminosityLevel < dimmerConfig.luminosityMin)
                    luminosityLevel = dimmerConfig.luminosityMin;
                if (luminosityLevel > dimmerConfig.luminosityMax)
                    luminosityLevel = dimmerConfig.luminosityMax;

                var luminosityPercent   = Math.round(((luminosity-dimmerConfig.luminosityMin)/luminosityWindow)*100);
                dimmerLevel             = (
                    (1/100)
                    * (
                        (luminosityPercent*dimmerConfig.levelMax)
                        + (100*dimmerConfig.levelMin)
                        - (luminosityPercent*dimmerConfig.levelMax)
                    )
                );

                break;
        }

        if (dimmerLevel > 99) {
            dimmerLevel = 99;
        }
    } else {
        self.resetInterval();
        self.vDev.set("metrics:icon", self.imagePath+'/icon_'+level+".png");
    }

    self.resetDelayTimeout();
    self.resetOffTimeout();
    self.vDev.set("metrics:triggered",mode);

    self.log('Turning '+(mode ? 'on':'off'));

    // Fake switching
    self.processDeviceList(self.config.lights,function(deviceObject) {
        var targetLevel;
        if (deviceObject.get('deviceType') === 'switchBinary') {
            targetLevel = (mode) ? 'on':'off';
        } else if (deviceObject.get('deviceType') === 'switchMultilevel') {
            targetLevel = (mode) ? dimmerLevel:0;
        } else {
            self.error('Unspported device type '+deviceObject.get('deviceType'));
            return;
        }
        self.log('Set '+deviceObject.id+' '+targetLevel);
        deviceObject.set('metrics:level',targetLevel,{ silent: true, setOnly: true });
        deviceObject.set('metrics:auto',mode,{ silent: true, setOnly: true });
    });

    self.controller.emit('light.'+(mode ? 'on':'off'),{
        id:         self.id,
        mode:       mode,
        vDev:       self.vDev
    });

    // Real turning off
    self.processDeviceList(self.config.lights,function(deviceObject) {
        var level = deviceObject.get('metrics:level');
        var targetLevel;

        if (deviceObject.get('deviceType') === 'switchBinary') {
            targetLevel = (mode) ? 'on':'off';
            if (level === targetLevel) {
                self.log('Turn '+deviceObject.id+' '+targetLevel);
                deviceObject.performCommand(targetLevel);
            } else {
                self.log('Keep '+deviceObject.id);
            }
        } else if (deviceObject.get('deviceType') === 'switchMultilevel') {
            targetLevel = (mode) ? dimmerLevel:0;
            if (targetLevel === level) {
                self.log('Turn '+deviceObject.id+' '+targetLevel);
                if (level ===  0) {
                    deviceObject.performCommand('off');
                } else {
                    deviceObject.performCommand('exact',{ level: level });
                }
            } else {
                self.log('Keep '+deviceObject.id);
            }
        }
    });
};

// Reset interval helper
MotionTrigger.prototype.resetInterval = function() {
    var self = this;

    if (typeof(self.checkInterval) !== 'undefined') {
        clearInterval(self.checkInterval);
        self.checkInterval = undefined;
    }
};

// Reset timeout helper
MotionTrigger.prototype.resetOffTimeout = function() {
    var self = this;

    if (typeof(self.offTimeout) !== 'undefined') {
        clearTimeout(self.offTimeout);
        self.offTimeout = undefined;
    }
    self.vDev.set('metrics:offTime',null);
};

// Reset delay helper
MotionTrigger.prototype.resetDelayTimeout = function() {
    var self = this;

    if (typeof(self.delayTimeout) !== 'undefined') {
        clearTimeout(self.delayTimeout);
        self.delayTimeout = undefined;
    }
    self.vDev.set('metrics:delaytimeout',null);
};