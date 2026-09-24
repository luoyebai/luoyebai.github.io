#!/bin/sh
set -eu
WORK=${WORK:-"$HOME/mini-linux-lab"}
exec qemu-system-x86_64 \
  -kernel "$WORK/linux-6.12.111/arch/x86/boot/bzImage" \
  -initrd "$WORK/initramfs.cpio.gz" \
  -append 'console=ttyS0 rdinit=/init' \
  -m 256M -nographic -no-reboot
