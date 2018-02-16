# Cicada

Cicada (started as Chupacabra) is a lightweight Node.js application with web browser interface for discovery and monitoring network devices.

Supported protocols: ICMP (ping), SNMP v1/2c/3, Modbus TCP, IPMI, WMI and http/s (plain-text, json, xml).<br>
Also you can polling [Zabbix](http://www.zabbix.com/download), [Check-mk](https://mathias-kettner.de/checkmk_linuxagent.html) and [Munin](https://github.com/munin-monitoring/munin-c) agents and check TCP ports.

Cross-platform, open source, extendable, free.<br>
[Demo](http://77.37.160.20:5000/) (read-only), [overview video](https://www.youtube.com/watch?v=qHYKD5LzBwA), 
[documentation](https://github.com/little-brother/cicada/wiki).

# Features
* Multi-protocol device polling
* Live network diagrams
* Individual and group check threshold values for devices
* Calculated and temporary varbinds
* Templates to create device copy in one click
* Extreme compact storage of history data (2-4Byte per numeric value)
* Historization of non-numeric values
* Flexible mechanism of alert messages
* Alert management
* Anomaly detection
* Notify on new device in network
* and MORE!

![Screenshots](http://little-brother.ru/images/cicada4.gif)<br>

## Roadmap
* Dark theme
* SNMP auto-discovery (cpu, memory, disks)
* Template library
* Distributed
* Support for polling VMs, JVM, etc

## Requirements
* [Node.js](https://nodejs.org/en/download/) (JavaScript runtime engine)

Optional
* Protocol WMI: [wmic](https://www.krenger.ch/blog/wmi-commands-from-linux/) (Linux)
* Protocol SNMPv3: [Net-SNMP](http://www.net-snmp.org/)
* Protocol IPMI: [IPMItool](https://sourceforge.net/projects/ipmitool/)
* Anomaly detection: [Watchtower](https://github.com/little-brother/watchtower)

## Installation
1. [Download and unpack](https://github.com/little-brother/cicada/archive/master.zip) or run
   ```
   git clone --depth=1 https://github.com/little-brother/cicada.git
   ``` 
2. Run to install dependencies
   ```
   npm i
   ```
   <details>
   <summary>Troubleshooting</summary>	
     Cicada uses <code>sqlite</code> module. This module requires a build tools.<br>
     Run <code>npm i node-gyp -g</code> to install <code>node-gyp</code> (native addon build tool) and retry to install Cicada.<br>
     <br>
     
     If error occurs again then<br>
     <b>Windows</b>: install the previous Node.js version.<br>
     <b>Linux</b>: run <code>apt-get install build-essential</code> to install compiler.
   </details>		
3. Run Cicada
   ```
   node app
   ```
4. Go to browser and open url `http://127.0.0.1:5000`

## Usage
1. Set value type of varbind as number to view history on chart.
2. If value type of varbind is a number then log each values into `history.sqlite` file.<br> 
   Otherwise log only changes into `changes.sqlite`.	
3. Set up device and push &#128190; to save varbind list as template.<br>
   Template will be appear in "Add device"-menu and in scan results.
4. Read expression protocol help to learn about its power.
5. Start varbind name from `$` to create temporary (unlogged and hidden) varbind.
6. Cicada have a minimal diagram icon pack.<br> 
   You can use [Cisco Network Topology Icons](https://www.cisco.com/c/dam/en_us/about/ac50/ac47/3015_jpeg.zip) (unpack into `/public/images`) to expand it.
7. Device and varbind tags beginning with $ are not displayed on the dashboard
8. Hotkeys
    * **Ctrl + Alt + L** - logout and move to login page.	
    * **Ctrl + Alt + S** - show db stats page.	
    * **Ctrl + Alt + C** - open group check page.	
    * **Ctrl + Alt + A** - hide all active and visible alerts (only on Alert page).
9. Use middle button click to toggle application mode (devices or diagrams).

## Configuration (config.json)

* **port** - http-server port. By default `5000`. Next port number will be use to realtime update interface via websocket.

* **access** - define access by password.
  * **edit** - admin password. Can be empty.
  * **view** - operator password. Can be empty. 

* **db** - sqlite configuration on start up. By default is `{'synchronous': 0}`. See details in [Wiki](https://github.com/little-brother/cicada/wiki/English).

* **alerter-list** - set of alerter. Each alerter has next params
  * **event** - one of `on-change`, `on-normal`, `on-warning`, `on-critical`, `on-anomaly`.<br>
  * **command** - any shell command. You can use `${device.*}` and `${reason}`.
  * **options** - special command [options](https://nodejs.org/api/child_process.html#child_process_child_process_exec_command_options_callback). By default `{}`.	
  * **active** - the time when messages are sent in [Zabbix time periods format](https://www.zabbix.com/documentation/3.0/manual/appendix/time_period). By default is `empty` (any time).
  * **tag-list**/**tags** - list of device tags. If the list is empty then alerter applied to any device.
  
  See details in [Wiki](https://github.com/little-brother/cicada/wiki/English).

* **anomaly-detector**
  * **host** - ip of anomaly detection server.
  * **port** - port of anomaly detection server.
  * **tag-list** - array of varbind tags. Determines which variables will be checked.<br>
    Also you can set **tags** - one string with semicolon as tag delimiter.
    
  See details in [Wiki](https://github.com/little-brother/cicada/wiki/English).
    
* **catchers** - set of event catcher. Each catcher is daemon, eg `snmptrapd`, who catch incoming message.<br>
  Application parse daemon log, extract sender ip by pattern and force device polling with this ip.
  * **command** - the command to run.
  * **args** - list of string arguments.
  * **options** - optional [options](https://nodejs.org/api/child_process.html#child_process_child_process_spawn_command_args_options) for command.
  * **pattern** - regexp pattern to get ip address.
    
  See details in [Wiki](https://github.com/little-brother/cicada/wiki/English).

* **publisher** - send data to external server e.g. [`Graphite`](https://graphiteapp.org/) or publish on local tcp-port.
  * **host** - server host. If host is not set then application open local tcp-port and publish data to it.
  * **port** - by default `2003`. Or `5002` if host is empty.	
  * **pattern** - output row pattern. By default `${device.name}/${varbind.name} ${varbind.value} $time`.
  * **delimiter** - row delimiter. By default is `\r\n`
  * **only-numeric** - publish only `numeric` varbinds. By default `false`.	

* **auto-scan** - define params of process to check network on new devices. If `on-detect` is not set then auto-scan is off.
  * **period** - in seconds. By default `600`.
  * **range** - use next range format: `192.168.1-10.*, 10.10.1-2.3-23`. Already registered IP will be ignored.
  *	**on-detect** - shell command executed for each unknown devices. You can use `${ip}`, `${mac}` and `${description}`.

* **network-commands** - external commands to check devices. Uses `arp`, `ping` and `tracert`/`traceroute` by default.
  * **arp** - get a mapping of the MAC and ip addresses.
  * **ping** - ping device.
  * **trace** - trace route to device and return hop ips.
  
<details>
<summary>Example</summary>
<pre>
{
  "port": 5000,

  "access": {
    "edit": "mypassword",
    "view": ""
  },  

  "db": {
    "synchronous": 0,
    "cache_size": 4000
  }, 

  "alerter-list": [
    {
      "event": "on-warning",
      "tag-list": ["$EMAIL", "DB"],
      "command": "sendmail some@mail.com Device ${device.name} is warning for reason: ${reason}"
    },
    {
      "event": "on-critical",
      "tags": "$EMAIL;DB",
      "command": "sendmail some@mail.com Device ${device.name} is critical for reason: ${reason}"
    },
    {		  
      "event": "on-anomaly",
      "command": "echo %TIME% ${device.name} \"${reason}\" >> anomaly.txt"
    }
  ],

  "anomaly-detector": {
    "host": "localhost",
    "port": 8000,
    "tags": "CPU;DB;MEM"
  },

  "auto-scan": {
    "period": 600,
    "range": "192.168.0.1-255",
    "on-detect": {
      "command": "mail -s "New ${ip} found" user@example.com < /dev/null",
      "options": {}
    }
  },

  "publisher": {
    "port": 2000,
    "pattern": "${device.name}/${varbind.name} ${varbind.value} $time"
  },

  "network-commands": {
    "arp": "arp -a",
    "ping": "ping ${ip} -n 1",
    "trace": "tracert -d ${ip}"
  }
}
</pre>
</details>