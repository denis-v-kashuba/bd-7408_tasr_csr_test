const {Kafka, Partitioners} = require('kafkajs');
const {default: TasrClient} = require('tmg-tasr');
const {SchemaRegistry, SchemaType} = require('@kafkajs/confluent-schema-registry');

const {schema, referenceSchemas} = require('./etc/schemas/producerservice');

const name = 'tmg-kafka-csr-producer-framework-example';

const TOPIC_TO_PUBLISH_TO = 's_page_view';
const TASR_SCHEMA_VERSION = '8';

// ID of schema from ./csr/init.sh file
// const CSR_SCHEMA_ID = 1;

const now = Date.now();
const PUBLISH_DATA = {};

process.on('uncaughtException', (err) => {
  console.log(`${name} err_type=exception msg=${err.message} stack: ${err.stack}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, p) => {
  console.log(`${name} err_type=unhandled_rejection msg="Promise: ${p.name} reason: ${reason.message} stack: ${reason.stack}"`);
  process.exit(1);
});

async function run_flow() {

  const config = {
    brokers: 'localhost:9092',
    tasrURL: 'https://tasr.use1.odpprod.com/tasr/subject',
    csrConfig: {
      url: 'https://api.confluent-schema-registry.arms.use1.amz.odpprod.com/'
    }
  };

// only grabbing the connection info for the first worker
  const {brokers, csrConfig, tasrURL} = config;
  const {url: csrURL} = csrConfig;

  console.info(`Our env is next brokers ${brokers} and csrURL ${csrURL}`);

  const kafka = new Kafka({
    brokers,
    clientId: 'TestHandler1',
  });
  const admin = kafka.admin();
  const producer = kafka.producer({createPartitioner: Partitioners.LegacyPartitioner});

  await admin.connect();
  console.info('We have next topics:');
  console.info(`${await admin.listTopics()}`);

  await producer.connect();

//
// CSR
//

  const registry = new SchemaRegistry({host: csrURL});

  // Upload a schema to the registry
  const schema = `
  {"name": "PageView", "namespace": "tagged.events", "type": "record", "fields": [{"name": "source__timestamp", "type": "long"}, {"name": "source__agent", "type": "string"}, {"name": "source__ip_address", "type": "string"}, {"name": "page_view__request_uri", "type": "string"}, {"default": null, "name": "page_view__user_id", "type": ["null", "long"]}, {"name": "page_view__session_id", "type": "string"}, {"name": "page_view__ips", "type": "string"}, {"name": "page_view__is_redirect", "type": "boolean"}, {"name": "page_view__guid", "type": "string"}, {"default": null, "name": "page_view__domain", "type": ["null", "string"]}, {"default": null, "name": "page_view__browser_id", "type": ["null", "string"]}, {"default": null, "name": "meta__topic_name", "type": ["null", "string"]}, {"default": null, "name": "meta__request_user_agent", "type": ["null", "string"]}, {"default": null, "name": "meta__request_session_id", "type": ["null", "string"]}, {"default": null, "name": "meta__request_id", "type": ["null", "string"]}, {"default": null, "name": "meta__kvpairs", "type": ["null", {"default": null, "type": "map", "values": ["null", "string"]}]}, {"default": null, "name": "meta__handlers", "type": ["null", {"items": {"fields": [{"name": "timestamp", "type": "long"}, {"name": "agent", "type": "string"}, {"name": "ip_address", "type": "string"}], "name": "Handler", "namespace": "tagged.events", "type": "record"}, "type": "array"}]}]}
  `
  const { CSR_SCHEMA_ID } = await registry.register({
    type: SchemaType.AVRO,
    schema
  });

  const outgoingMessage = {
    key: TOPIC_TO_PUBLISH_TO,
    value: await registry.encode(CSR_SCHEMA_ID, PUBLISH_DATA),
  };

  await producer.send({
    topic: TOPIC_TO_PUBLISH_TO,
    messages: [outgoingMessage],
  });

  console.info(`CSR message have been sent to ${TOPIC_TO_PUBLISH_TO}`);

//
// TASR
//

  const tasrClient = TasrClient.getInstance({tasrURL});

  PUBLISH_DATA.tmgtest__test = 'test_2';

  const avroSchema = await tasrClient
    .lookupSchemaByTopicAndVersion(TOPIC_TO_PUBLISH_TO, TASR_SCHEMA_VERSION);
  const encodedValue = avroSchema.toBuffer(PUBLISH_DATA);

  const outgoingMessageTasr = {
    key: 'key',
    value: encodedValue,
  };

  await producer.send({
    topic: TOPIC_TO_PUBLISH_TO,
    messages: [outgoingMessageTasr],
  });
  console.info('TASR message have been sent');

  await producer.disconnect();

  process.exit(0);

}

run_flow();
