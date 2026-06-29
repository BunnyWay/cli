// Ambient declarations for the bunny.net Scriptable DNS runtime. The runtime injects these as globals; scripts use them without importing.

/** The DNS request passed to the `handleQuery` entry function. */
interface DnsRequest {
  /** The DNS query that contains the details about the request. */
  request: DnsQuery;
}

/** The details of an incoming DNS query. */
interface DnsQuery {
  /** The hostname that is being queried. */
  hostname: string;
  /** The IP of the remote client that sent the DNS query. */
  clientIP: string;
  /** The query question type (A, AAAA, TXT). */
  queryType: string;
  /** The EDNS0 IP attached by the client. */
  ednsIP: string;
  /** The geo location of the client. */
  geoLocation: GeoLocation;
  /** The server zone of the DNS server that received the query (DE, UK, SG). */
  serverZone: string;
}

/** A geographic location resolved for a client or an IP. */
interface GeoLocation {
  /** The latitude of the location. */
  latitude: number;
  /** The longitude of the location. */
  longitude: number;
  /** The two letter ISO country code. */
  country: string;
  /** The detected ASN number. */
  asn: number;
}

/** An A record answer. */
declare class ARecord {
  constructor(ip: string, ttl?: number);
  /** The IP of the A record. */
  ip: string;
  /** The TTL of the answer. */
  ttl: number;
}

/** An AAAA record answer. */
declare class AaaaRecord {
  constructor(ip: string, ttl?: number);
  /** The IP of the AAAA record. */
  ip: string;
  /** The TTL of the answer. */
  ttl: number;
}

/** A CNAME record answer. */
declare class CnameRecord {
  constructor(hostname: string, ttl?: number);
  /** The hostname of the CNAME record. */
  hostname: string;
  /** The TTL of the answer. */
  ttl: number;
}

/** A TXT record answer. */
declare class TxtRecord {
  constructor(value: string, ttl?: number);
  /** The value of the TXT record. */
  value: string;
  /** The TTL of the answer. */
  ttl: number;
}

/** Maps the response to a pull zone, resolving to its A or AAAA records. */
declare class PullZoneRecord {
  constructor(pullzone: string);
  /** The name of the pull zone. */
  pullzone: string;
}

/** A server passed to or returned from the routing helpers. */
declare class Server {
  constructor(
    ip: string,
    latitude?: number,
    longitude?: number,
    weight?: number,
    online?: boolean,
  );
  /** The IP of the server. */
  ip: string;
  /** The geographical latitude of the server. */
  latitude: number;
  /** The geographical longitude of the server. */
  longitude: number;
  /** The routing weight of the server in a weighted routing scenario. */
  weight: number;
  /** Whether the server is currently considered online for health routing. */
  online: boolean;
}

/** The uptime status returned by `Monitoring.getStatus`. */
interface MonitoringStatus {
  /** Whether the IP is currently online. */
  isOnline: boolean;
  /** The last measured latency from the DNS server to this IP. */
  latency: number;
}

/** Checks and monitors the uptime status of an IP in the background. */
declare const Monitoring: {
  getStatus(ip: string): MonitoringStatus;
};

/** Looks up the geo location of an IP address using a GeoDNS database. */
declare const GeoDatabase: {
  resolve(ip: string): GeoLocation;
};

/** Calculates the distance between two geographical points. */
declare const GeoDistance: {
  calculate(lat1: number, lon1: number, lat2: number, lon2: number): number;
  calculate(loc1: GeoLocation, loc2: GeoLocation): number;
  calculate(server: Server, location: GeoLocation): number;
  calculate(location: GeoLocation, server: Server): number;
};

/** Dynamic geographic routing, weight calculation, and round robin logic. */
declare const RoutingEngine: {
  getWeightedRandom(
    servers: Server[],
    onlineOnly?: boolean,
    applyWeight?: boolean,
  ): Server;
  getClosestServer(
    servers: Server[],
    location: GeoLocation,
    onlineOnly?: boolean,
    applyWeight?: boolean,
  ): Server;
};

/** A single response object the `handleQuery` entry function may return. */
type DnsResponse =
  | ARecord
  | AaaaRecord
  | CnameRecord
  | TxtRecord
  | PullZoneRecord
  | Server;

/** Any value the `handleQuery` entry function may return: one response or many. */
type DnsAnswer = DnsResponse | DnsResponse[];
