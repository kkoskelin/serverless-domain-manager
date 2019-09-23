"use strict";
/**
 * Wrapper class for Custom Domain information
 */
class DomainInfo {
    constructor(domain, serverless, options) {
        this.basePath = "";
        this.securityPolicy = "TLS_1_2";
        this.endpointType = "EDGE";
        this.enabled = true;
        this.websocket = false;
        this.createRoute53Record = true;
        this.endpointTypes = {
            edge: "EDGE",
            regional: "REGIONAL",
        };
        this.tlsVersions = {
            tls_1_0: "TLS_1_0",
            tls_1_2: "TLS_1_2",
        };
        this.fallbackHostedZoneId = "Z2FDTNDATAQYW2";
        this.domainName = domain.domainName;
        if (typeof this.domainName === "undefined") {
            throw new Error(`domainName is required. Pass it on your serverless.yaml file.`);
        }
        if (typeof domain.enabled !== "undefined") {
            this.enabled = this.evaluateEnabled(domain.enabled);
        }
        if (typeof domain.websocket !== "undefined") {
            this.websocket = this.evaluateEnabled(domain.websocket);
        }
        if (typeof domain.basePath !== "undefined" && domain.basePath !== null && domain.basePath.trim() !== "") {
            this.basePath = domain.basePath;
        }
        if (typeof domain.stage !== "undefined") {
            this.stage = domain.stage;
        }
        else {
            this.stage = options.stage || serverless.service.provider.stage;
        }
        if (typeof domain.certificateName !== "undefined") {
            this.certificateName = domain.certificateName;
        }
        if (typeof domain.certificateArn !== "undefined") {
            this.certificateArn = domain.certificateArn;
        }
        if (typeof domain.securityPolicy !== "undefined" && this.tlsVersions[domain.securityPolicy.toLowerCase()]) {
            this.securityPolicy = this.tlsVersions[domain.securityPolicy.toLowerCase()];
        }
        else if (typeof domain.securityPolicy !== "undefined" && !this.tlsVersions[domain.securityPolicy.toLowerCase()]) {
            throw new Error(`${domain.securityPolicy} is not a supported securityPolicy, use tls_1_0 or tls_1_2.`);
        }
        if (typeof domain.endpointType === "undefined" && !this.websocket) {
            this.endpointType = "EDGE";
        }
        else if (this.websocket) {
            this.endpointType = "REGIONAL";
        }
        else if (typeof domain.endpointType !== "undefined" && this.endpointTypes[domain.endpointType.toLowerCase()]) {
            this.endpointType = this.endpointTypes[domain.endpointType.toLowerCase()];
        }
        else {
            throw new Error(`${domain.endpointType} is not supported endpointType, use edge or regional.`);
        }
        if (typeof domain.hostedZoneId !== "undefined") {
            this.hostedZoneId = domain.hostedZoneId;
        }
        if (typeof domain.createRoute53Record !== "undefined") {
            this.createRoute53Record = domain.createRoute53Record;
        }
        if (typeof domain.hostedZonePrivate !== "undefined") {
            this.hostedZonePrivate = domain.hostedZonePrivate;
        }
    }
    SetApiGatewayRespV1(data) {
        this.aliasTarget = data.distributionDomainName || data.regionalDomainName;
        this.aliasHostedZoneId = data.distributionHostedZoneId || data.regionalHostedZoneId || this.fallbackHostedZoneId;
    }
    SetApiGatewayRespV2(data) {
        this.aliasTarget = data.DomainNameConfigurations[0].ApiGatewayDomainName;
        this.aliasHostedZoneId = data.DomainNameConfigurations[0].HostedZoneId;
    }
    isRegional() {
        const regional = this.endpointType === this.endpointTypes.regional ? true : false;
        return regional;
    }
    /**
     * Transforms string booleans to booleans or throws error if not possible
     */
    evaluateEnabled(value) {
        if (typeof value === "boolean") {
            return value;
        }
        else if (typeof value === "string" && value === "true") {
            return true;
        }
        else if (typeof value === "string" && value === "false") {
            return false;
        }
        else {
            throw new Error(`serverless-domain-manager: Ambiguous enablement boolean: "${value}"`);
        }
    }
}
module.exports = DomainInfo;
