# A practical first-boot checklist

## Basic Hardening

Change root password

```bash
passwd
```

Create a non-root user for daily use

```bash
adduser username
usermod -aG sudo username
```

Disable root SSH login

```bash
nano /etc/ssh/sshd_config
# Set PermitRootLogin no
systemctl restart sshd
```

## System Update

```bash
apt update && apt full-upgrade -y
reboot
```

## SD/USB Health

Reduce SD/USB wear - lower swappiness

```bash
echo "vm.swappiness=10" >> /etc/sysctl.conf
sysctl -p
```

Move /tmp to RAM

```bash
echo "tmpfs /tmp tmpfs defaults,nosuid,nodev,size=32M 0 0" >> /etc/fstab
```

## Setup ZRAM

Install zram

```bash
apt install zram-tools -y
nano /etc/default/zramswap
```

Set these values

```bash
ALGO=lz4
PERCENT=50
```

Verify

```bash
systemctl restart zramswap
zramctl
```

## Install Docker

Install docker in one-line

```bash
curl -fsSL https://get.docker.com | sh

# Add your user to docker group
usermod -aG docker $USER
```

Limit docker's logging

```bash
nano /etc/docker/daemon.json
```

Add these values:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "5m",
    "max-file": "2"
  }
}
```

Restart docker service

```bash
systemctl restart docker
```

## Monitoring Tools (Optional)

Install `htop`, `iotop`, or `btop`

```bash
apt install htop iotop btop -y
```

Watch temps

```bash
# Divide by 1000 = °C
cat /sys/class/thermal/thermal_zone0/temp
```
