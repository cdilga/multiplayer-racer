#!/usr/bin/env python3
import socket
import subprocess
import platform
import re
import netifaces
import psutil

def current_method():
    """The current method we're using in the app"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception as e:
        print(f"Error with current method: {e}")
        return None

def using_hostname():
    """Try to get IP using hostname"""
    try:
        hostname = socket.gethostname()
        ip = socket.gethostbyname(hostname)
        return ip
    except Exception as e:
        print(f"Error with hostname method: {e}")
        return None

def using_netifaces():
    """Get all IPs from all interfaces using netifaces"""
    results = {}
    try:
        # Get all interfaces
        interfaces = netifaces.interfaces()
        
        for interface in interfaces:
            addrs = netifaces.ifaddresses(interface)
            # Only get IPv4 addresses
            if netifaces.AF_INET in addrs:
                for addr in addrs[netifaces.AF_INET]:
                    if 'addr' in addr:
                        ip = addr['addr']
                        # Skip localhost addresses
                        if not ip.startswith('127.'):
                            results[interface] = ip
        return results
    except Exception as e:
        print(f"Error with netifaces method: {e}")
        return {}

def using_psutil():
    """Get IPs using psutil"""
    results = {}
    try:
        net_if_addrs = psutil.net_if_addrs()
        for interface, addresses in net_if_addrs.items():
            for addr in addresses:
                if addr.family == socket.AF_INET and not addr.address.startswith('127.'):
                    results[interface] = addr.address
        return results
    except Exception as e:
        print(f"Error with psutil method: {e}")
        return {}

def platform_specific():
    """Use platform-specific commands to get IP"""
    system = platform.system()
    result = None
    
    try:
        if system == 'Darwin':  # macOS
            output = subprocess.check_output("ifconfig | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}'", shell=True)
            ips = output.decode().strip().split('\n')
            if ips:
                # We'll return all IPs found
                return ips
                
        elif system == 'Linux':
            output = subprocess.check_output("hostname -I | awk '{print $1}'", shell=True)
            return output.decode().strip()
            
        elif system == 'Windows':
            output = subprocess.check_output("ipconfig | findstr /i \"IPv4 Address\"", shell=True)
            ips = re.findall(r'(\d+\.\d+\.\d+\.\d+)', output.decode())
            if ips:
                # Filter out localhost addresses
                return [ip for ip in ips if not ip.startswith('127.')]
                
    except Exception as e:
        print(f"Error with platform-specific method ({system}): {e}")
        
    return result

def is_private_ip(ip):
    """Check if an IP is a private network address"""
    # RFC 1918 private IP ranges
    private_ranges = [
        ('10.0.0.0', '10.255.255.255'),     # 10.0.0.0/8
        ('172.16.0.0', '172.31.255.255'),   # 172.16.0.0/12
        ('192.168.0.0', '192.168.255.255')  # 192.168.0.0/16
    ]
    
    # Convert IP to integer for comparison
    def ip_to_int(ip):
        parts = ip.split('.')
        return (int(parts[0]) << 24) + (int(parts[1]) << 16) + (int(parts[2]) << 8) + int(parts[3])
    
    ip_int = ip_to_int(ip)
    
    for start, end in private_ranges:
        if ip_to_int(start) <= ip_int <= ip_to_int(end):
            return True
    
    return False

def rank_ips(ips):
    """Rank IPs by likelihood of being the correct internal IP"""
    ranked = []
    
    for ip in ips:
        score = 0
        
        # Prefer IPs in the 192.168.x.x range (most common for home networks)
        if ip.startswith('192.168.'):
            score += 10
            
        # Then prefer 10.x.x.x range (common for larger networks)
        elif ip.startswith('10.'):
            score += 5
            
        # Then prefer 172.16-31.x.x range (less common)
        elif re.match(r'^172\.(1[6-9]|2[0-9]|3[0-1])\.', ip):
            score += 3
            
        # Avoid virtual and VPN IPs if possible
        if 'tun' in ip or 'vpn' in ip or 'virtual' in ip:
            score -= 5
            
        ranked.append((ip, score))
        
    # Sort by score descending
    return sorted(ranked, key=lambda x: x[1], reverse=True)

if __name__ == "__main__":
    print("Testing different methods to detect internal IP address:")
    print("=" * 60)
    
    print(f"CURRENT METHOD: {current_method()}")
    print(f"HOSTNAME METHOD: {using_hostname()}")
    
    print("\nNETIFACES METHOD:")
    netifaces_results = using_netifaces()
    for interface, ip in netifaces_results.items():
        print(f"  {interface}: {ip} {'(PRIVATE)' if is_private_ip(ip) else ''}")
    
    print("\nPSUTIL METHOD:")
    psutil_results = using_psutil()
    for interface, ip in psutil_results.items():
        print(f"  {interface}: {ip} {'(PRIVATE)' if is_private_ip(ip) else ''}")
    
    print("\nPLATFORM SPECIFIC METHOD:")
    platform_results = platform_specific()
    if isinstance(platform_results, list):
        for ip in platform_results:
            print(f"  {ip} {'(PRIVATE)' if is_private_ip(ip) else ''}")
    else:
        print(f"  {platform_results} {'(PRIVATE)' if platform_results and is_private_ip(platform_results) else ''}")
    
    # Collect all unique IPs
    all_ips = set()
    if current_method():
        all_ips.add(current_method())
    if using_hostname() and not using_hostname().startswith('127.'):
        all_ips.add(using_hostname())
    all_ips.update([ip for ip in netifaces_results.values()])
    all_ips.update([ip for ip in psutil_results.values()])
    if isinstance(platform_results, list):
        all_ips.update(platform_results)
    elif platform_results:
        all_ips.add(platform_results)
    
    # Filter out non-private IPs
    private_ips = [ip for ip in all_ips if is_private_ip(ip)]
    
    print("\nALL DETECTED PRIVATE IPs (RANKED):")
    ranked_ips = rank_ips(private_ips)
    for ip, score in ranked_ips:
        print(f"  {ip} (score: {score})")
    
    if ranked_ips:
        print(f"\nRECOMMENDED IP: {ranked_ips[0][0]}")
        if ranked_ips[0][0] == '192.168.11.14':
            print("✓ MATCHED USER'S EXPECTED IP (192.168.11.14)")
        else:
            print("✗ DID NOT MATCH USER'S EXPECTED IP (192.168.11.14)")
    
    print("\nRECOMMENDATION:")
    print("Based on these results, update your get_local_ip() function in server/app.py") 