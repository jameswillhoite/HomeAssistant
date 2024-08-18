// Shelly Script example: MQTT Auto Discovery in Home Assistant
//
// This script is registering a virtual switch device in HA
// The implementation is banal and directly reports switch state and controls a switch
// but you can have a totally different virtual device: valve, light, scene
// Reference:
// https://www.home-assistant.io/docs/mqtt/discovery/
//
// MQTT configuration.yaml contains this section:
// mqtt:
//   broker: 127.0.0.1
//   discovery: true
//   discovery_prefix: garage_homeassistant

/*
 * This is my version of the MQTT Discovery for HomeAssistant with a Shelly Plus 1 device.
 * This will register the device as a Cover, in HomeAssistant. It will report the state the 
 * garage is current in. Also reports, opening, closing, open, closed and the position (Open or Closed)
 *
 */

/**
 * @typedef {"switch" | "binary_sensor"} HADeviceType
 * @typedef {"config"|"stat"|"cmd"} HATopicType
 */
let DEBUG = false;

let CONFIG = {
  shelly_id: null,
  shelly_mac: null,
  shelly_fw_id: null,
  shelly_model: null,
  ha_mqtt_ad: "homeassistant",
  device_name: "Big Garage Door",
  payloads: {
    on: "on",
    off: "off",
  },
};

let DEVICE = {
  name: null,
  ids: null,
  mdl: "Plus 1",
  mf: "Shelly",
  sw_version: null,
}

Shelly.call("Shelly.GetDeviceInfo", {}, function (result) {
  if(DEBUG)
  {
    console.log("Shelly.GetDeviceInfo", result);
  }
  
  CONFIG.shelly_id = result.id;
  CONFIG.shelly_mac = result.mac;
  CONFIG.shelly_fw_id = result.fw_id;
  CONFIG.shelly_model = result.model;
  
  DEVICE.name = CONFIG.device_name;
  DEVICE.ids = [CONFIG.shelly_mac, CONFIG.shelly_id];
  DEVICE.sw_version = CONFIG.shelly_fw_id;
  initMQTT();
});

/**
 * @param   {HADeviceType}   hatype HA device type
 * @returns {string} topic - ha_mqtt_auto_discovery_prefix/device_type/device_id/config
 */
function buildMQTTConfigTopic(hatype) {
  return CONFIG.ha_mqtt_ad + "/" + hatype + "/" + CONFIG.shelly_id + "/config";
}

/**
 * @param   {HADeviceType}   hatype HA device type
 * @param   {HATopicType}    topic HA topic
 * @returns {string}
 */
function buildMQTTStateCmdTopics(hatype, topic) {
  let _t = topic || "";
  if (_t.length) {
    _t = "/" + _t;
  }
  return CONFIG.shelly_id + "/" + hatype + _t;
}

/**
 * @param {boolean} sw_state
 */
function switchActivate(sw_state) {
  if(DEBUG)
  {
    console.log("SwitchActivate value: " + sw_state);  
  }
  
  Shelly.call("Switch.Set", {
    id: 0,
    on: sw_state,
  });
}

/**
 * @param {string} topic
 * @param {string} message
 */
function MQTTCmdListener(topic, message) {
  if(DEBUG)
  {
    console.log("Command Listener: " + message);
  }
  
  Shelly.call("Input.GetStatus", {"id": 0}, function(result) {
      if (DEBUG)
      {
        console.log("CmdListener > Input.GetStatus", result);
      }
      
      if(result.state)
      {
        // Door is open send closing
        MQTT.publish(buildMQTTStateCmdTopics("cover", "state"), "closing", 0, false);
        //Wait 10 seconds and then mark door as closed
        Timer.set(
           10000,
           false,
           function() {
             MQTT.publish(buildMQTTStateCmdTopics("cover", "state"), "closed", 0, false);
           }
         );
      }
      else {
        //Door is closed, open the door
        MQTT.publish(buildMQTTStateCmdTopics("cover", "state"), "opening", 0, false);
      } 
      switchActivate(true);  
  });
  
}

// until 0.10.0 event and notifications were emitted by switch
// after that only notification is emitted
Shelly.addStatusHandler(function (notification) {
  if(notification.name === "script" || notification.source === "timer") {
    if(DEBUG)
    {
      console.log("AddStatusHandler > ignore values script/timer");
    }
    
    return;
  }
  
  //console.log("Notification: ", notification);
  let _state_str = "";
  
  if (typeof notification.delta.output === "undefined") return;
  
  switch(notification.component)
  {
    case "switch:0":
      _state_str = notification.delta.output ? "open" : "closed";
      //MQTT.publish(buildMQTTStateCmdTopics("cover", "state"), _state_str);
      break;
      
    case "input:0":
      _state_str = notification.delta.state ? "1" : "0";
      MQTT.publish(buildMQTTStateCmdTopics("cover", "position"), _state_str, 0, false);
      _state_str = notification.delta.state ? "open" : "closed";
      MQTT.publish(buildMQTTStateCmdTopics("cover", "state"), _state_str, 0, false);
      break;
  }
});

function initMQTT() {
  //Listen for the Command Call
  MQTT.subscribe(buildMQTTStateCmdTopics("cover", "cmd"), MQTTCmdListener);
  
  //Register this Device
  MQTT.publish(
    buildMQTTConfigTopic("cover"),
    JSON.stringify({
      name: DEVICE.name,
      device: DEVICE,
      unique_id: CONFIG.shelly_id,
      payload_close: CONFIG.payloads.off,
      payload_open: CONFIG.payloads.on,
      payload_stop: null,
      position_open: 1,
      position_closed: 0,
      command_topic: "~/cmd",
      state_topic: "~/state",
      position_topic: "~/position",
      "~": buildMQTTStateCmdTopics("cover")
    }),
    0,
    true
  );
  
  //Report the Status On Boot
  Shelly.call("Input.GetStatus", {"id": 0}, function (result) {
    let _state_str = result.state ? "1" : "0";
    MQTT.publish(buildMQTTStateCmdTopics("cover", "position"), _state_str, 0, false);
    _state_str = result.state ? "open" : "closed";
    MQTT.publish(buildMQTTStateCmdTopics("cover", "state"), _state_str, 0, false);
  });
  
  //Report the Status of the Door every 2 minutes
  Timer.set(
   120000,
   true,
   function() {
     Shelly.call("Input.GetStatus", {"id": 0}, function(result) {
       if(DEBUG)
       {
         console.log("Timer Input.GetStatus", result);
       }
       
       MQTT.publish(buildMQTTStateCmdTopics("cover", "state"), result.state ? "open" : "closed", 0, false);
       MQTT.publish(buildMQTTStateCmdTopics("cover", "position"), result.state ? "1" : "0", 0, false);
     }); 
   }
 );
  
 
}
