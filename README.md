# Chupacabra

Chupacabra is a lightweight Node.js application with web browser interface for discovery and monitoring network devices.<br>
Supported protocols: ICMP, SNMP v1/2c, Modbus TCP, WMI and http/s.<br>
Also you can polling [**Zabbix**](http://www.zabbix.com/download), [**Check-mk**](https://mathias-kettner.de/checkmk_linuxagent.html) and [**Munin**](https://github.com/munin-monitoring/munin-c) agents and check TCP/UDP ports.

# Features
* Check device by any supported protocols
* View history separate by device and varbind group on dashboard
* Calculated varbind
* Online statuses and charts on device page
* Templates to create copy in one click
* Alerts when device change status by user conditions
* Alert on new device in network

Try [**demo**](http://77.37.160.20:5000/). Remote user has read-only access.<br>
Visit our [**Wiki**](https://github.com/little-brother/chupacabra/wiki) to learn more.<br>
Are you need more features? Try [**Little Brother**](https://github.com/little-brother/little-brother)!

![Screenshots](http://little-brother.ru/images/chupacabra2.gif)<br>

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
1. Set value type of varbind as number to view history on chart.
2. If value type of varbind is a number then log each values into `history.sqlite` file.<br> 
   Otherwise log only changes into `changes.sqlite`.	
3. Double click on varbind address toggle to calculated mode.<br>
   Example: `($CPU + $GPU)/2` get average of CPU (name) and GPU (name) varbinds.<br>
   Warning: supported only english words without spaces as varbind names.<br>
4. Set up device and push &#128190; to save varbind list as template.<br>
   Template will be appear in "Add device"-menu and in scan results.

## Configuration (config.json)
* **port** - http-server port. By default `5000`. Next port number will be use to realtime update interface via websocket.
* **access** - define access by ips.
  * **edit** (array) - allowed edit from those ips. By default is `["127.0.0.1", "::ffff:127.0.0.1", "localhost"]`.
  * **view** (array) - allowed view from those ips. By default is `any`. 
* **ping-period** - in seconds. By default `300`.
* **on-status-change** 
  * command - Any shell command. You can use `${device.*}` and `${reason}`. Available device props: `status` (0, 1, 2 or 3), `prev_status`, `name`, `ip`, `mac` and `alive` (ping status; true/false). By default is empty.
    <br>Example: `echo %TIME% ${device.status} ${device.name} >> log.txt`
  * options - Special command [options](https://nodejs.org/api/child_process.html#child_process_child_process_spawn_command_args_options). By default `{}`.
* **on-warning** and **on-critical** - similar **on-status-change**. These commands triggers when device changed status to `2` (warning) or `3` (critical).
* **auto-scan** - Define params of process to check network on new devices. If `on-detect` is not set then auto-scan is off.
  * **period** - in seconds. By default `600`.
  * **range** - use nmap range format e.g. `192.168.0.1-255`. Already registered IP will be ignored.
  *	**on-detect** - Shell command executed for each unknown devices. You can use `${ip}`, `${mac}` and `${description}`.