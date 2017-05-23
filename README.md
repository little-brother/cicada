# Chupacabra

Chupacabra is a lightweight Node.js application with web browser interface for discovery and monitoring network devices.<br>
Supported protocols: ICMP, SNMP v1/2c, Modbus TCP, WMI and http/s. Also you can check TCP/UDP ports and polling [**Zabbix agents**](http://www.zabbix.com/download). 

# Features
* Check device by any supported protocol
* View history separate by device and varbind group on dashboard
* Online statuses and charts on device page
* Templates to create copy in one click
* Alerts when device change status by user conditions
* Alert on new device in network

Are you need more features? Try [**Little Brother**](https://github.com/little-brother/little-brother)!

Try [demo](http://77.37.160.20:5000/). Remote user has read-only access.

## Requirements
* [**Node.js**](https://nodejs.org/en/download/) (JavaScript runtime engine)
* [**nmap**](https://nmap.org/download.html) (network scanner)
* [**wmic**](https://www.krenger.ch/blog/wmi-commands-from-linux/) (command line tools; only if you use *nix and want polling Windows machines)

## Installation
1. [**Download and unpack**](https://github.com/little-brother/chupacabra/archive/master.zip) or run

   ```
   git clone --depth=1 https://github.com/little-brother/chupacabra.git
   ``` 
2. Run to install dependencies
   ```
   npm i
   ```
3. Run Chupacabra
   ```
   node app
   ```
4. Go to browser and open url `http://127.0.0.1:5000`

## Usage
1. Set value type of varbind as number to view history as chart
2. Add status conditions to log varbind value. It's not necessaty if value type is number.
3. Set up device and push &#128190; to save varbind list as template.<br>
   Template will be appear in "Add device"-menu and in scan results.
4. If device don't has varbinds then status calc by ping result. Overwise, ping result is ignored.

## Configuration (config.json)
* **port** - http-server port. By default `5000`. Next port number will be use to realtime update interface via websocket. 
* **ping-period** - in seconds. By default `30`.
* **on-status-change** 
  * command - Any shell command. You can use `${device.*}`. Available device props: `status` (0, 1, 2 or 3), `prev_status`, `name`, `ip`, `mac` and `alive` (ping status; true or false). By default is empty.
    <br>Example: `echo %TIME% ${device.status} ${device.name} >> log.txt`
  * options - Special command [options](https://nodejs.org/api/child_process.html#child_process_child_process_spawn_command_args_options). By default `{}`.
* **auto-scan** - Define params of process to check network on new devices. If `on-detect` is not set then auto-scan is off.
  * **period** - in seconds. By default `300`.
  * **range** - use nmap range format e.g. `192.168.0.1-255`. Already registered IP will be ignored.
  *	**on-detect** - Shell command executed for each unknown devices. You can use `${ip}`, `${mac}` and `${description}`.