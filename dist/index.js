"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const chalk_1 = require("chalk");
const DomainInfo = require("./DomainInfo");
const certStatuses = ["PENDING_VALIDATION", "ISSUED", "INACTIVE"];
class ServerlessCustomDomain {
    constructor(serverless, options) {
        this.serverless = serverless;
        this.options = options;
        this.commands = {
            create_domain: {
                lifecycleEvents: [
                    "create",
                    "initialize",
                ],
                usage: "Creates a domain using the domain name defined in the serverless file",
            },
            delete_domain: {
                lifecycleEvents: [
                    "delete",
                    "initialize",
                ],
                usage: "Deletes a domain using the domain name defined in the serverless file",
            },
        };
        this.hooks = {
            "after:deploy:deploy": this.hookWrapper.bind(this, this.propogateMappings),
            "after:info:info": this.hookWrapper.bind(this, this.domainSummary),
            "before:remove:remove": this.hookWrapper.bind(this, this.removeMappings),
            "create_domain:create": this.hookWrapper.bind(this, this.createDomains),
            "delete_domain:delete": this.hookWrapper.bind(this, this.deleteDomains),
        };
    }
    /**
     * Wrapper for lifecycle function, initializes variables and checks if enabled.
     * @param lifecycleFunc lifecycle function that actually does desired action
     */
    hookWrapper(lifecycleFunc) {
        return __awaiter(this, void 0, void 0, function* () {
            this.initializeDomainManager();
            if (this.domains.size === 0) {
                const msg = "No domains are enabled. To use Domain Manager pass 'enabled: true' in your serverless.yaml";
                this.domainManagerLog(msg);
            }
            return yield lifecycleFunc.call(this);
        });
    }
    /**
     * Lifecycle function to create a domain
     * Wraps creating a domain and resource record set
     */
    createDomains() {
        return __awaiter(this, void 0, void 0, function* () {
            const iterator = this.domains.entries();
            const results = new Map();
            let domain = iterator.next();
            while (!domain.done) {
                const domainInfo = domain.value[1];
                try {
                    yield this.getAliasInfo(domainInfo);
                }
                catch (err) {
                    if (err.code === "NotFoundException") {
                        const msg = `Domain ${domainInfo.domainName} not found. Creating...`;
                        this.logIfDebug(msg);
                    }
                }
                try {
                    if (!domainInfo.aliasTarget) {
                        if (!domainInfo.certificateArn) {
                            yield this.getCertArn(domainInfo);
                        }
                        yield this.createCustomDomain(domainInfo);
                        yield this.changeResourceRecordSet("UPSERT", domainInfo);
                        const msg = `${domainInfo.domainName} was created. Could take up to 40 minutes to be initialized.`;
                        results.set(domain.value[0], msg);
                        domain = iterator.next();
                    }
                    else {
                        const msg = `Domain ${domainInfo.domainName} already exists. Skipping...`;
                        results.set(domain.value[0], msg);
                        domain = iterator.next();
                    }
                }
                catch (err) {
                    if (err.code === "TooManyRequestsException") {
                        this.logIfDebug("Too many requests. Retrying in 5s.");
                        yield this.sleep(5000);
                    }
                }
            }
            [...results.values()].forEach((msg) => {
                this.domainManagerLog(msg);
            });
        });
    }
    /**
     * Lifecycle function to delete a domain
     * Wraps deleting a domain and resource record set
     */
    deleteDomains() {
        return __awaiter(this, void 0, void 0, function* () {
            const iterator = this.domains.entries();
            const results = new Map();
            let domain = iterator.next();
            while (!domain.done) {
                const domainInfo = domain.value[1];
                try {
                    yield this.getAliasInfo(domainInfo);
                    yield this.deleteCustomDomain(domainInfo);
                    yield this.changeResourceRecordSet("DELETE", domainInfo);
                    const msg = `Domain ${domainInfo.domainName} was deleted.`;
                    results.set(domain.value[0], msg);
                    domain = iterator.next();
                }
                catch (err) {
                    switch (err.code) {
                        case "NotFoundException":
                            this.domainManagerLog(`Couldn't find ${domainInfo.domainName}. Skipping delete...`);
                            domain = iterator.next();
                            break;
                        case "TooManyRequestsException":
                            this.logIfDebug("Too many requests. Retrying in 5s.");
                            yield this.sleep(5000);
                            break;
                        default:
                            this.logIfDebug(err);
                            const msg = `Unable to delete ${domainInfo.domainName}. SLS_DEBUG=* for more info.`;
                            this.domainManagerLog(msg);
                            results.set(domain.value[0], err);
                            domain = iterator.next();
                    }
                }
            }
            results.forEach((msg) => {
                this.domainManagerLog(msg);
            });
        });
    }
    /**
     * Lifecycle function to setup API mappings for HTTP and websocket endpoints
     */
    // FIXME: edit to handle going from a valued apiMappingKey to an empty key
    propogateMappings() {
        return __awaiter(this, void 0, void 0, function* () {
            const iterator = this.domains.entries();
            const successful = new Map();
            let domain = iterator.next();
            while (!domain.done) {
                const domainInfo = domain.value[1];
                try {
                    if (domainInfo.enabled) {
                        const apiId = yield this.getApiId(domainInfo);
                        const mapping = yield this.getMapping(apiId, domainInfo);
                        if (!mapping) {
                            yield this.createApiMapping(apiId, domainInfo);
                            this.addOutputs(domainInfo);
                            successful.set(domainInfo, "successful");
                            continue;
                        }
                        if (mapping.apiMappingKey !== domainInfo.basePath) {
                            yield this.updateApiMapping(mapping.apiMappingId, domainInfo, apiId);
                            this.addOutputs(domainInfo);
                            successful.set(domainInfo, "successful");
                            continue;
                        }
                        else {
                            this.logIfDebug(`Path for ${domainInfo.domainName} is already current. Skipping...`);
                        }
                    }
                }
                catch (err) {
                    this.logIfDebug(err.message);
                }
                domain = iterator.next();
            }
            if (successful.size > 0) {
                yield this.domainSummary();
            }
        });
    }
    /**
     * Lifecycle function to print domain summary
     * Wraps printing of all domain manager related info
     */
    domainSummary() {
        return __awaiter(this, void 0, void 0, function* () {
            const iterator = this.domains.entries();
            const results = new Map();
            let domain = iterator.next();
            while (!domain.done) {
                const domainInfo = domain.value[1];
                if (domainInfo.createRoute53Record !== false) {
                    try {
                        yield this.getAliasInfo(domainInfo);
                        results.set(domain.value[0], {
                            aliasHostedZoneId: domainInfo.aliasHostedZoneId,
                            aliasTarget: domainInfo.aliasTarget,
                            domainName: domainInfo.domainName,
                            websocket: domainInfo.websocket,
                        });
                    }
                    catch (err) {
                        const msg = `Unable to print Serverless Domain Manager Summary for ${domainInfo.domainName}`;
                        this.domainManagerLog(err);
                        results.set(domain.value[0], msg);
                    }
                }
                else {
                    results.set(domain.value[0], "Route53 record not created.");
                }
                domain = iterator.next();
            }
            const sorted = [...results.values()].sort();
            this.printDomainSummary(sorted);
        });
    }
    /**
     * Initializes DomainInfo class with domain specific variables, and
     * SDK APIs if and only if there are enabled domains. Otherwise will
     * return undefined.
     */
    initializeDomainManager() {
        if (typeof this.serverless.service.custom === "undefined") {
            throw new Error("serverless-domain-manager: Plugin configuration is missing.");
        }
        else if (typeof this.serverless.service.custom.customDomain === "undefined") {
            throw new Error("serverless-domain-manager: Plugin configuration is missing.");
        }
        this.domains = new Map();
        let customDomains = this.serverless.service.custom.customDomain;
        if (!Array.isArray(customDomains))
            customDomains = [customDomains];
        customDomains
            .map((customDomain) => {
            const domain = new DomainInfo(customDomain, this.serverless, this.options);
            if (!domain.enabled) {
                const msg = `Domain generation for ${domain.domainName} has been disabled. Skipping...`;
                this.domainManagerLog(msg);
                return;
            }
            this.domains.set(domain.domainName, domain);
        });
        if (this.domains.size > 0) {
            let credentials;
            credentials = this.serverless.providers.aws.getCredentials();
            this.apigateway = new this.serverless.providers.aws.sdk.APIGateway(credentials);
            this.apigatewayv2 = new this.serverless.providers.aws.sdk.ApiGatewayV2(credentials);
            this.route53 = new this.serverless.providers.aws.sdk.Route53(credentials);
            this.cloudformation = new this.serverless.providers.aws.sdk.CloudFormation(credentials);
            this.acm = new this.serverless.providers.aws.sdk.ACM(credentials);
        }
    }
    /**
     * Gets Certificate ARN that most closely matches domain name OR given Cert ARN if provided
     */
    getCertArn(domain) {
        return __awaiter(this, void 0, void 0, function* () {
            if (domain.certificateArn) {
                this.domainManagerLog(`Selected specific certificateArn ${domain.certificateArn}`);
                return;
            }
            let certificateArn; // The arn of the choosen certificate
            let certificateName = domain.certificateName; // The certificate name
            let certData;
            try {
                if (domain.isRegional()) {
                    this.acmRegion = this.serverless.providers.aws.getRegion();
                    this.acm.config.update({ region: this.acmRegion });
                    certData = yield this.acm.listCertificates({ CertificateStatuses: certStatuses }).promise();
                }
                else {
                    this.acm.config.update({ region: "us-east-1" });
                    certData = yield this.acm.listCertificates({ CertificateStatuses: certStatuses }).promise();
                }
                // The more specific name will be the longest
                let nameLength = 0;
                const certificates = certData.CertificateSummaryList;
                // Checks if a certificate name is given
                if (certificateName != null) {
                    const foundCertificate = certificates
                        .find((certificate) => (certificate.DomainName === certificateName));
                    if (foundCertificate != null) {
                        certificateArn = foundCertificate.CertificateArn;
                    }
                }
                else {
                    certificateName = domain.domainName;
                    certificates.forEach((certificate) => {
                        let certificateListName = certificate.DomainName;
                        // Looks for wild card and takes it out when checking
                        if (certificateListName[0] === "*") {
                            certificateListName = certificateListName.substr(1);
                        }
                        // Looks to see if the name in the list is within the given domain
                        // Also checks if the name is more specific than previous ones
                        if (certificateName.includes(certificateListName)
                            && certificateListName.length > nameLength) {
                            nameLength = certificateListName.length;
                            certificateArn = certificate.CertificateArn;
                        }
                    });
                }
            }
            catch (err) {
                this.logIfDebug(err);
                throw Error(`Error: Could not list certificates in Certificate Manager.\n${err}`);
            }
            if (certificateArn == null) {
                throw Error(`Error: Could not find the certificate ${certificateName}.`);
            }
            domain.certificateArn = certificateArn;
        });
    }
    /**
     * Gets domain info as DomainInfo object if domain exists, otherwise returns false
     */
    getAliasInfo(domain) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const domainInfo = yield this.apigatewayv2.getDomainName({ DomainName: domain.domainName }).promise();
                domain.SetApiGatewayRespV2(domainInfo);
                this.domains.set(domain.domainName, domain);
            }
            catch (err) {
                if (err.code === "NotFoundException") {
                    throw err;
                }
                throw new Error(`Error: Unable to fetch information about ${domain.domainName}`);
            }
        });
    }
    /**
     * Creates Custom Domain Name through API Gateway
     * @param certificateArn: Certificate ARN to use for custom domain
     */
    createCustomDomain(domain) {
        return __awaiter(this, void 0, void 0, function* () {
            let createdDomain = {};
            try {
                if (!domain.websocket) {
                    // Set up parameters
                    const params = {
                        certificateArn: domain.certificateArn,
                        domainName: domain.domainName,
                        endpointConfiguration: {
                            types: [domain.endpointType],
                        },
                        regionalCertificateArn: domain.certificateArn,
                    };
                    if (!domain.isRegional()) {
                        params.regionalCertificateArn = undefined;
                    }
                    else {
                        params.certificateArn = undefined;
                    }
                    createdDomain = yield this.apigateway.createDomainName(params).promise();
                    domain.SetApiGatewayRespV1(createdDomain);
                    this.domains.set(domain.domainName, domain);
                }
                else {
                    const params = {
                        DomainName: domain.domainName,
                        DomainNameConfigurations: [
                            {
                                CertificateArn: domain.certificateArn,
                                EndpointType: domain.endpointType,
                            },
                        ],
                    };
                    createdDomain = yield this.apigatewayv2.createDomainName(params).promise();
                    domain.SetApiGatewayRespV2(createdDomain);
                    this.domains.set(domain.domainName, domain);
                }
            }
            catch (err) {
                if (err.code === "TooManyRequestsException") {
                    throw err;
                }
                throw new Error(`Error: Failed to create custom domain ${domain.domainName}\n`);
            }
        });
    }
    /**
     * Delete Custom Domain Name through API Gateway
     */
    deleteCustomDomain(domain) {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {
                DomainName: domain.domainName,
            };
            // Make API call
            try {
                yield this.apigatewayv2.deleteDomainName(params).promise();
            }
            catch (err) {
                if (err.code === "TooManyRequestsException") {
                    throw err;
                }
                throw new Error(`Error: Failed to delete custom domain ${domain.domainName}\n`);
            }
        });
    }
    /**
     * Change A Alias record through Route53 based on given action
     * @param action: String descriptor of change to be made. Valid actions are ['UPSERT', 'DELETE']
     * @param domain: DomainInfo object containing info about custom domain
     */
    changeResourceRecordSet(action, domain) {
        return __awaiter(this, void 0, void 0, function* () {
            if (action !== "UPSERT" && action !== "DELETE") {
                throw new Error(`Error: Invalid action "${action}" when changing Route53 Record.
                Action must be either UPSERT or DELETE.\n`);
            }
            if (domain.createRoute53Record !== undefined && domain.createRoute53Record === false) {
                this.domainManagerLog("Skipping creation of Route53 record.");
                return;
            }
            // Set up parameters
            const route53HostedZoneId = yield this.getRoute53HostedZoneId(domain);
            const Changes = ["A", "AAAA"].map((Type) => ({
                Action: action,
                ResourceRecordSet: {
                    AliasTarget: {
                        DNSName: domain.aliasTarget,
                        EvaluateTargetHealth: false,
                        HostedZoneId: domain.aliasHostedZoneId,
                    },
                    Name: domain.domainName,
                    Type,
                },
            }));
            const params = {
                ChangeBatch: {
                    Changes,
                    Comment: "Record created by serverless-domain-manager",
                },
                HostedZoneId: route53HostedZoneId,
            };
            // Make API call
            try {
                yield this.route53.changeResourceRecordSets(params).promise();
            }
            catch (err) {
                this.logIfDebug(err);
                throw new Error(`Error: Failed to ${action} A Alias for ${domain.domainName}\n`);
            }
        });
    }
    /**
     * Gets Route53 HostedZoneId from user or from AWS
     */
    getRoute53HostedZoneId(domain) {
        return __awaiter(this, void 0, void 0, function* () {
            if (domain.hostedZoneId) {
                this.domainManagerLog(`Selected specific hostedZoneId ${domain.hostedZoneId}`);
                return domain.hostedZoneId;
            }
            const filterZone = domain.hostedZonePrivate !== undefined;
            if (filterZone && domain.hostedZonePrivate) {
                this.domainManagerLog("Filtering to only private zones.");
            }
            else if (filterZone && !domain.hostedZonePrivate) {
                this.domainManagerLog("Filtering to only public zones.");
            }
            let hostedZoneData;
            const givenDomainNameReverse = domain.domainName.split(".").reverse();
            try {
                hostedZoneData = yield this.route53.listHostedZones({}).promise();
                const targetHostedZone = hostedZoneData.HostedZones
                    .filter((hostedZone) => {
                    let hostedZoneName;
                    if (hostedZone.Name.endsWith(".")) {
                        hostedZoneName = hostedZone.Name.slice(0, -1);
                    }
                    else {
                        hostedZoneName = hostedZone.Name;
                    }
                    if (!filterZone || domain.hostedZonePrivate === hostedZone.Config.PrivateZone) {
                        const hostedZoneNameReverse = hostedZoneName.split(".").reverse();
                        if (givenDomainNameReverse.length === 1
                            || (givenDomainNameReverse.length >= hostedZoneNameReverse.length)) {
                            for (let i = 0; i < hostedZoneNameReverse.length; i += 1) {
                                if (givenDomainNameReverse[i] !== hostedZoneNameReverse[i]) {
                                    return false;
                                }
                            }
                            return true;
                        }
                    }
                    return false;
                })
                    .sort((zone1, zone2) => zone2.Name.length - zone1.Name.length)
                    .shift();
                if (targetHostedZone) {
                    const hostedZoneId = targetHostedZone.Id;
                    // Extracts the hostzone Id
                    const startPos = hostedZoneId.indexOf("e/") + 2;
                    const endPos = hostedZoneId.length;
                    return hostedZoneId.substring(startPos, endPos);
                }
            }
            catch (err) {
                this.logIfDebug(err);
                throw new Error(`Error: Unable to list hosted zones in Route53.\n${err}`);
            }
            throw new Error(`Error: Could not find hosted zone "${domain.domainName}"`);
        });
    }
    getMapping(ApiId, domain) {
        return __awaiter(this, void 0, void 0, function* () {
            let apiMappingId;
            let apiMappingKey;
            let Items = undefined;
            try {
                if (domain.websocket) {
                    const mappingInfo = yield this.apigatewayv2.getApiMappings({
                        DomainName: domain.domainName,
                    }).promise();
                    Items = mappingInfo.Items;
                }
                else {
                    const mappingInfo = yield this.apigateway.getBasePathMappings({
                        domainName: domain.domainName,
                    }).promise();
                    this.logIfDebug(mappingInfo);
                    Items = (mappingInfo && (mappingInfo.items || [])).map(item => ({
                        ApiId: item.restApiId,
                        ApiMappingId: null,
                        ApiMappingKey: item.basePath,
                        Stage: item.stage,
                    }));
                }
            }
            catch (err) {
                this.logIfDebug(err);
                if (err.code === "NotFoundException") {
                    throw err;
                }
                throw new Error(`Error: Unable to get mappings for ${domain.domainName}`);
            }
            if (Items !== undefined && Items instanceof Array) {
                for (const m of Items) {
                    if (m.ApiId === ApiId) {
                        apiMappingId = m.ApiMappingId;
                        apiMappingKey = m.ApiMappingKey;
                        break;
                    }
                }
            }
            return apiMappingId ? { apiMappingId, apiMappingKey } : undefined;
        });
    }
    /**
     * Creates basepath mapping
     */
    createApiMapping(apiId, domain) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (domain.websocket) {
                    yield this.apigatewayv2.createApiMapping({
                        ApiId: apiId,
                        ApiMappingKey: domain.basePath,
                        DomainName: domain.domainName,
                        Stage: domain.stage,
                    }).promise();
                }
                else {
                    yield this.apigateway.createBasePathMapping({
                        domainName: domain.domainName,
                        restApiId: apiId,
                        basePath: domain.basePath,
                        stage: domain.stage,
                    }).promise();
                }
                this.domainManagerLog(`Created API mapping for ${domain.domainName}.`);
            }
            catch (err) {
                throw new Error(`${err}`);
            }
        });
    }
    /**
     * Updates basepath mapping
     */
    updateApiMapping(oldMappingId, domain, apiId) {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {
                ApiId: apiId,
                ApiMappingId: oldMappingId,
                ApiMappingKey: domain.basePath,
                DomainName: domain.domainName,
                Stage: domain.stage,
            };
            // Make API call
            try {
                yield this.apigatewayv2.updateApiMapping(params).promise();
                this.domainManagerLog(`Updated API mapping for ${domain.domainName}`);
            }
            catch (err) {
                this.logIfDebug(err);
                throw new Error(`Error: Unable to update mapping for ${domain.domainName}.\n`);
            }
        });
    }
    /**
     * Gets rest API id from CloudFormation stack
     */
    getApiId(domain) {
        return __awaiter(this, void 0, void 0, function* () {
            const provider = this.serverless.service.provider;
            if (!domain.websocket && provider.apiGateway && provider.apiGateway.restApiId) {
                const restApiId = provider.apiGateway.restApiId;
                const msg = `Mapping ${domain.domainName} to existing API ${restApiId}.`;
                this.domainManagerLog(msg);
                return provider.apiGateway.restApiId;
            }
            else if (domain.websocket && provider.apiGateway && provider.apiGateway.websocketApiId) {
                const websocketApiId = provider.apiGateway.websocketApiId;
                const msg = `Mapping ${domain.domainName} to existing API ${websocketApiId}.`;
                this.domainManagerLog(msg);
                return provider.apiGateway.websocketApiId;
            }
            const stackName = provider.stackName || `${this.serverless.service.service}-${domain.stage}`;
            const params = {
                LogicalResourceId: "",
                StackName: stackName,
            };
            if (!domain.websocket) {
                params.LogicalResourceId = "ApiGatewayRestApi";
            }
            else {
                params.LogicalResourceId = "WebsocketsApi";
            }
            let response;
            try {
                response = yield this.cloudformation.describeStackResource(params).promise();
            }
            catch (err) {
                this.logIfDebug(err);
                throw new Error(`Error: Failed to find CloudFormation resources for ${domain.domainName}\n`);
            }
            const apiID = response.StackResourceDetail.PhysicalResourceId;
            if (!apiID) {
                const conditional = !domain.websocket ? "RestApiId" : "WebsocketApiId";
                throw new Error(`Error: No ${conditional} associated with CloudFormation stack ${stackName}`);
            }
            return apiID;
        });
    }
    /**
     * Deletes basepath mapping
     */
    deleteMapping(apiMappingId, domain) {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {
                ApiMappingId: apiMappingId,
                DomainName: domain.domainName,
            };
            // Make API call
            try {
                yield this.apigatewayv2.deleteApiMapping(params).promise();
                this.domainManagerLog(`Removed mapping for ${domain.domainName}.`);
            }
            catch (err) {
                this.logIfDebug(err);
                this.domainManagerLog(`Unable to remove mapping for ${domain.domainName}.`);
            }
        });
    }
    /**
     *  Adds the domain name and distribution domain name to the CloudFormation outputs
     */
    addOutputs(domainInfo) {
        const service = this.serverless.service;
        if (!service.provider.compiledCloudFormationTemplate.Outputs) {
            service.provider.compiledCloudFormationTemplate.Outputs = {};
        }
        service.provider.compiledCloudFormationTemplate.Outputs.aliasTarget = {
            Value: domainInfo.aliasTarget,
        };
        if (domainInfo.aliasHostedZoneId) {
            service.provider.compiledCloudFormationTemplate.Outputs.aliasHostedZoneId = {
                Value: domainInfo.aliasHostedZoneId,
            };
        }
    }
    /**
     * Logs message if SLS_DEBUG is set
     * @param message message to be printed
     */
    logIfDebug(message) {
        if (process.env.SLS_DEBUG) {
            this.serverless.cli.log(message, "Domain Manager");
        }
    }
    /**
     * Logs domain manager specific messages
     * @param message message to be printed
     */
    domainManagerLog(message) {
        this.serverless.cli.log(message, "Domain Manager");
    }
    /**
     * Lifecycle function to remove API mappings for HTTP and websocket endpoints
     */
    removeMappings() {
        return __awaiter(this, void 0, void 0, function* () {
            const iterator = this.domains.entries();
            let domain = iterator.next();
            while (!domain.done) {
                const domainInfo = domain.value[1];
                try {
                    if (domainInfo.enabled) {
                        const apiId = yield this.getApiId(domainInfo);
                        const currentMapping = yield this.getMapping(apiId, domainInfo);
                        yield this.deleteMapping(currentMapping, domainInfo);
                        domain = iterator.next();
                    }
                }
                catch (err) {
                    switch (err.code) {
                        case "NotFoundException":
                            this.logIfDebug(`Mappings for domain ${domainInfo} not found. Skipping...`);
                            break;
                        default:
                            this.logIfDebug(err);
                            const msg = `Unable to remove mapping for ${domainInfo.domainName}. SLS_DEBUG=* for more info.`;
                            this.domainManagerLog(msg);
                    }
                    domain = iterator.next();
                }
            }
        });
    }
    /**
     * Prints out a summary of all domain manager related info
     */
    printDomainSummary(print) {
        this.serverless.cli.consoleLog(chalk_1.default.yellow.underline("Serverless Domain Manager Summary"));
        print.forEach((v) => {
            if (typeof v === "object") {
                const apiType = !v.websocket ? "REST" : "Websocket";
                this.serverless.cli.consoleLog(chalk_1.default.yellow(`${v.domainName} (${apiType}):`));
                this.serverless.cli.consoleLog(`  Target Domain: ${v.aliasTarget}`);
                this.serverless.cli.consoleLog(`  Hosted Zone Id: ${v.aliasHostedZoneId}`);
            }
            else {
                this.serverless.cli.consoleLog(print);
            }
        });
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
module.exports = ServerlessCustomDomain;
