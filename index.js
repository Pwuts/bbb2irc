const MQTT = require('mqtt');
const IRC = require('irc-upd');
IRC.Client.prototype.setTopic = function(target, text) {
    this._speak('TOPIC', target, text);
}


/* MQTT stuff */

const mqttClient = MQTT.connect('mqtt://test.mosquitto.org');
mqttClient.on('connect', _packet => {
    console.log('Connected to MQTT broker');
});

mqttClient.subscribe('revspace/b', { rh: true }, error => error ? console.error('Could not subscribe to topic:', error) : null);

let bbbOnlineCount;
const getBbbStatus = () => bbbOnlineCount > 0 ? 'OPEN' : 'OFFLINE';

mqttClient.on('message', (topic, message) => {
    // console.debug('MQTT message:', topic, message);
    if (topic == 'revspace/b') {
        bbbOnlineCount = Number(message) - 1;
        console.debug(`MQTT reports ${bbbOnlineCount} users online in BBB (excluding bar)`);
        if (currentTopic) updateTopic();
    }
});


/* IRC stuff */

const ownNick = 'bbbot';
const channel = '#revspace-test';
const topicSeparator = ' % ';

const bbbInstanceBaseURL = 'https://meet.nluug.nl';
let bbbMeetingID = 'seb-2uy-is9';
const getBbbMeetingURL = () => bbbInstanceBaseURL + '/b/' + bbbMeetingID;

const client = new IRC.Client('chat.freenode.net', ownNick, {
    channels: [channel],
});

client.addListener('join', function (channel, nick) {
    if (nick !== ownNick) return;

    console.info(`IRC: joined ${channel} as ${nick}; channels:`, client.chans);
});

let currentTopic;

client.addListener('topic', function (_channel, topic, nick) {
    currentTopic = parseTopic(topic);
    console.debug('IRC parsed topic:', currentTopic);

    if (nick == ownNick && currentTopic.bbbSegment) return;

    const topicMeetingID = currentTopic.bbbSegment?.meetingID;
    if (topicMeetingID && topicMeetingID !== bbbMeetingID) {
        console.info('meeting ID changed:', bbbMeetingID, '->', topicMeetingID);
        bbbMeetingID = topicMeetingID;
    }

    if (bbbOnlineCount != null) updateTopic();
});

client.addListener('message', function (authorNick, channel, text) {
    if (/!b\s?/.test(text)) {
        client.say(channel, `${authorNick}: ${bbbOnlineCount || 'no'} ${bbbOnlineCount == 1 ? 'user' : 'users'} online in BBB (${getBbbMeetingURL()})`);
    }
});

/* topic logic */
const bbbSegmentMatcher = RegExp(`${bbbInstanceBaseURL}/b/(?<meetingID>[a-z0-9\-]+)(?: \\((?<status>[A-Z]+)\\))?`);

function parseTopic(topic)
{
    const segments = topic.split(topicSeparator);

    let parsedTopic = {
        raw: topic,
        rawSegments: segments,
    };

    for (let i = 1; i < segments.length; i++)
    {
        if (bbbSegmentMatcher.test(segments[i])) {
            const match = bbbSegmentMatcher.exec(segments[i]);
            parsedTopic = {
                ...parsedTopic,
                bbbSegmentIndex: i,
                bbbSegment: {
                    raw: segments[i],
                    url: match[0],
                    meetingID: match.groups.meetingID,
                    status: match.groups.status,
                }
            };
            break;
        }
    }

    return parsedTopic;
}

function generateTopic(parsedTopic, newStatus)
{
    const desiredBbbString = `${getBbbMeetingURL()} (${newStatus})`;

    if (parsedTopic.raw.includes(desiredBbbString)) return parsedTopic.raw;

    if (parsedTopic.bbbSegment) {
        return parsedTopic.raw.replace(bbbSegmentMatcher, desiredBbbString);
    }

    parsedTopic.rawSegments
               .splice(1, 0, [desiredBbbString]);

    return parsedTopic.rawSegments.join(topicSeparator);
}

function updateTopic()
{
    const desiredTopic = generateTopic(currentTopic, getBbbStatus());

    if (currentTopic.raw !== desiredTopic) {
        console.debug(`IRC current topic: "${currentTopic.raw}"`);
        console.debug(`IRC desired topic: "${desiredTopic}"`);

        client.setTopic(channel, desiredTopic);
        console.debug('IRC topic updated');
    }
    else {
        console.debug('IRC topic not changed');
    }
}
