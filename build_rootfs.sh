#!/bin/bash
set -e
echo "=== Building clean Debian 13 root filesystem (TTL) ==="

# 1. Prepare working directory
ROOTFS_DIR=$(pwd)/pure_rootfs
sudo rm -rf "$ROOTFS_DIR"
mkdir -p "$ROOTFS_DIR"

# 2. Create Debian 13 (Trixie) base system with debootstrap
echo "Creating Debian 13 (Trixie) armhf root filesystem with debootstrap..."
sudo debootstrap --arch=armhf --foreign --variant=minbase \
  --include=systemd,systemd-sysv,dbus,ifupdown,net-tools,iputils-ping,openssh-server,ssh,sudo,vim-tiny,wget,curl,cron,rsyslog,isc-dhcp-client,locales \
  trixie "$ROOTFS_DIR" http://deb.debian.org/debian/

# 3. Prepare chroot environment
echo "Preparing chroot environment..."
sudo cp /usr/bin/qemu-arm-static "$ROOTFS_DIR/usr/bin/"
sudo cp /etc/resolv.conf "$ROOTFS_DIR/etc/"

# Mount virtual filesystems
sudo mount -t proc /proc "$ROOTFS_DIR/proc"
sudo mount -t sysfs /sys "$ROOTFS_DIR/sys"
sudo mount -o bind /dev "$ROOTFS_DIR/dev"
sudo mount -o bind /dev/pts "$ROOTFS_DIR/dev/pts"

# 4. Create chroot configuration script
CHROOT_SCRIPT="/tmp/chroot_install.sh"
sudo cat > "$CHROOT_SCRIPT" << 'INNER_EOF'
#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
export LC_ALL=C

# Configure Debian repositories for Trixie (you can change to a faster mirror if needed)
cat > /etc/apt/sources.list << 'SOURCES'
deb http://deb.debian.org/debian trixie main contrib non-free non-free-firmware
deb http://deb.debian.org/debian trixie-updates main contrib non-free non-free-firmware
deb http://deb.debian.org/debian-security trixie-security main contrib non-free non-free-firmware
SOURCES

apt-get update
apt-get upgrade -y

# Basic system configuration
echo "debian" > /etc/hostname
echo -e "127.0.0.1\tlocalhost\n127.0.1.1\tdebian" > /etc/hosts
ln -sf /usr/share/zoneinfo/Asia/Ho_Chi_Minh /etc/localtime
echo "root:1234" | chpasswd
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config

# Network configuration (DHCP on eth0)
mkdir -p /etc/network/interfaces.d
echo -e "auto eth0\niface eth0 inet dhcp" > /etc/network/interfaces.d/eth0

# Enable serial console for USB-UART (ttyAMA0)
echo "T0:23:respawn:/sbin/getty -L ttyAMA0 115200 vt100" >> /etc/inittab

# Enable necessary modules
apt-get install -y initramfs-tools kmod sudo nano curl ca-certificates openssh-server htop binutils bsdmainutils apt-utils
update-initramfs -u -k all || true

# Cleanup
apt-get autoremove -y
apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
rm -f /usr/bin/qemu-arm-static

echo "✅ Debian configuration inside chroot completed"
INNER_EOF

sudo chmod +x "$CHROOT_SCRIPT"
sudo cp "$CHROOT_SCRIPT" "$ROOTFS_DIR/tmp/"

# 5. Run the chroot second stage and then your script
echo "Executing second stage debootstrap and configuration..."
# First, complete the debootstrap installation
sudo chroot "$ROOTFS_DIR" /debootstrap/debootstrap --second-stage

# Now run your custom script
sudo chroot "$ROOTFS_DIR" /bin/bash -c "/tmp/chroot_install.sh"

# 6. Unmount virtual filesystems
sudo umount -lf "$ROOTFS_DIR/dev/pts" 2>/dev/null || true
sudo umount -lf "$ROOTFS_DIR/dev" 2>/dev/null || true
sudo umount -lf "$ROOTFS_DIR/sys" 2>/dev/null || true
sudo umount -lf "$ROOTFS_DIR/proc" 2>/dev/null || true

echo "=== Clean Debian 13 root filesystem build completed ==="
echo "Rootfs location: $ROOTFS_DIR"
echo "Default root password: root123  (Please change it immediately after first boot!)"
