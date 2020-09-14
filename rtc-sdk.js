
// 采集、管理本地音频和视频流
class LocalMedia {
  _stream = null

  constructor({
    mediaOptions,
    onStreamSuccess,
    onStreamError,
    onStreamInactive,
  }) {
    this.mediaOptions = mediaOptions;
    this.onStreamSuccess = onStreamSuccess
    this.onStreamError = onStreamError
    this.onStreamInactive = onStreamInactive
  }

  create = () => {
    return navigator
      .mediaDevices
      .getUserMedia(this.mediaOptions)
      .then(this._mediaSuccess)
      .catch(this._mediaError)
  }

  _mediaSuccess = (stream) => {
    this._stream = stream;
    // const audioTracks = stream.getAudioTracks();
    // const videoTracks = stream.getVideoTracks();

    stream.oninactive = () => {
      console.log('Media stream inactived.');
      this.onStreamInactive && this.onStreamInactive()
    };
    this.onStreamSuccess && this.onStreamSuccess(stream);

    return stream;
  }

  _mediaError = (e) => {
    console.error(`navigator.MediaDevices.getUserMedia error: ${e.message} ${e.name}`);
    throw new Error(e);
  }

  stop = () => {
    if (!this._stream) {
      return;
    }
    this._stream.getTracks().forEach(track => track.stop());
    this._stream = null;
  }
}

class ConnectRTC {
  localPeer = null
  remotePeer = null
  _localServers = null
  _remoteServers = null

  constructor({
    localServers = null,
    remoteServers = null,
    onLocalConnectSuccess,
    onRemoteConnectSuccess,
  }) {
    this._localServers = localServers;
    this._remoteServers = remoteServers;
    this._onLocalConnectSuccess = onLocalConnectSuccess;
    this._onRemoteConnectSuccess = onRemoteConnectSuccess;
  }

  connect = () => {
    this._connectLocal();
    this._connectRemote();
  }

  close = () => {
    this.localPeer.close();
    this.localPeer = null;

    this.remotePeer.close();
    this.remotePeer = null;
  }

  // 使用本地流创建一个 RTCPeerConnection 实例
  _connectLocal = () => {
    this.localPeer = new RTCPeerConnection(this._localServers);
    this.localPeer.addEventListener(
      'icecandidate',
      this._connectICE
    );
    this.localPeer.addEventListener(
      'iceconnectionstatechange',
      this._connectChange
    );
  }

  // 使用远程流创建一个 RTCPeerConnection 实例
  _connectRemote = () => {
    this.remotePeer = new RTCPeerConnection(this._remoteServers);
    this.remotePeer.addEventListener(
      'icecandidate',
      this._connectICE
    );
    this.remotePeer.addEventListener(
      'iceconnectionstatechange',
      this._connectChange
    );
  }

  _connectICE = async (event) => {
    const peerConnection = event.target;
    const iceCandidate = event.candidate;

    if (iceCandidate) {
      // 获取和分享网络信息
      const newIceCandidate = new RTCIceCandidate(iceCandidate);
      const peerName = this._getPeerName(peerConnection);
      try {
        await this._getSidePeer(peerConnection).addIceCandidate(newIceCandidate)
        this._handleConnectionSuccess(peerConnection);
        if (peerName === 'localPeer') {
          this._onLocalConnectSuccess && this._onLocalConnectSuccess();
        } else {
          this._onRemoteConnectSuccess && this._onRemoteConnectSuccess();
        }
      } catch (error) {
        this._handleConnectionFailure(peerConnection, error)
      }
    }
  }

  _connectChange = event => {
    const peerConnection = event.target;
    console.log(`${this._getPeerName(peerConnection)} ICE state: ` +
      `${peerConnection.iceConnectionState}.`);
  }

  _getSidePeer(peerConnection) {
    return (peerConnection === this.localPeer)
      ? this.remotePeer
      : this.localPeer;
  }

  _getPeerName = (peerConnection) => {
    return (peerConnection === this.localPeer)
      ? 'localPeer'
      : 'remotePeer';
  }

  _handleConnectionSuccess = (peerConnection) => {
    console.log(`${this._getPeerName(peerConnection)} addIceCandidate success.`);
  };

  _handleConnectionFailure(peerConnection, error) {
    console.error(`${this._getPeerName(peerConnection)} failed to add ICE Candidate:\n` +
      `${error.toString()}.`);
  }
}

class OfferAnswerRTC extends ConnectRTC {
  _offerOptions = null

  constructor(options) {
    super(options);
    const {
      offerOptions,
      onGotRemoteStream,
    } = options;
    this._offerOptions = offerOptions;
    this.onGotRemoteStream = onGotRemoteStream;
  }

  create = async (localStream) => {
    if (!localStream) {
      console.error('OfferAnswerRTC localStream 不能为空.');
      return;
    }
    if (!this.localPeer) {
      console.error('OfferAnswerRTC create error, this.localPeer 不能为空.');
      return;
    }

    this.localPeer.addStream(localStream);
    this.remotePeer.addEventListener('addstream', e => {
      this._gotRemoteStream(e)
    });

    await this._createLocalOffer();
    await this._createRemoteAnswer();
  }

  // 收到远程 stream 流后的处理
  _gotRemoteStream = (event) => {
    const mediaStream = event.stream;
    this.remoteStream = mediaStream;
    this.onGotRemoteStream && this.onGotRemoteStream(mediaStream);
    console.log('Remote peer connection received remote stream.');
  }

  // 获取和分享本地和远端的描述
  _createLocalOffer = async () => {
    try {
      const description = await this.localPeer.createOffer(this._offerOptions)

      await [
        this._setLocalDescription(this.localPeer, description),
        this._setRemoteDescription(this.remotePeer, description)
      ];
    } catch (error) {
      this._descriptionError(error)
    }
  }

  _createRemoteAnswer = async () => {
    try {
      const description = await this.remotePeer.createAnswer();

      await [
        this._setLocalDescription(this.remotePeer, description),
        this._setRemoteDescription(this.localPeer, description)
      ];

    } catch (error) {
      this._descriptionError(error);
    }
  }

  _setLocalDescription = async (peerConnection, description) => {
    try {
      await peerConnection.setLocalDescription(description);
    } catch (error) {
      this._descriptionError(error);
    }
  }

  _setRemoteDescription = async (peerConnection, description) => {
    try {
      await peerConnection.setRemoteDescription(description)
    } catch (error) {
      this._descriptionError(error);
    }
  }

  _descriptionError = (error) => {
    console.error(`Failed to create session description: ${error.toString()}.`);
  }
}


class RTCStatus {
  /**
   * @description RTC状态 code 码
   */
  static STATUS_MAP = {
    'UN_INIT': 0, // 未初始化
    'START': 1001, // RTC 业务开始
    'LOCAL_MEDIA_GOTED': 1002, // 本地媒体创建成功
    'REMOTE_STREAM_SUCCESS': 1004, // 远程端响应流信息
    'REMOTE_CONNECT_SUCCESS': 1005, // 远程端链接成功
    'CLOSED': 1099,
  }
  _rtcStatusCode = 0

  constructor(options) {
    const { onChange } = options || {};
    this.onChange = onChange;
  }

  set = (code) => {
    console.log('RTC status code:', code);
    this._rtcStatusCode = code;

    this.onChange && this.onChange(code);
  }

  get = () => {
    return this._rtcStatusCode;
  }

  getStatusText = (code) => {
    const nowCode = code || this._rtcStatusCode;
    const STATUS_MAP = RTCStatus.STATUS_MAP;
    switch (nowCode) {
      case STATUS_MAP.UN_INIT:
      case STATUS_MAP.CLOSED:
        return '空闲';
      case STATUS_MAP.START:
        return '拨打中';
      case STATUS_MAP.REMOTE_STREAM_SUCCESS:
        return '接听中';
      case STATUS_MAP.REMOTE_CONNECT_SUCCESS:
        return '通话中';

      default:
        return '';
    }
  }
}

class RTCSDK extends OfferAnswerRTC {
  media = null
  mediaOptions = {
    audio: true, // 启用音频媒体
    video: true, // 启用视频媒体
  }

  constructor(options) {
    const {
      mediaOptions,
      onLocalStreamSuccess,
      onLocalStreamError,
      onLocalStreamInactive,
      onGotRemoteStream,
      onRemoteConnectSuccess,
      onStatusChange,
    } = options;

    super({
      ...options,
      onRemoteConnectSuccess: (...args) => {
        this.rtcStatusInstance.set(RTCStatus.STATUS_MAP.REMOTE_CONNECT_SUCCESS); // 远程端响应流信息
        return onRemoteConnectSuccess && onRemoteConnectSuccess(...args)
      },
      onGotRemoteStream: (...args) => {
        this.rtcStatusInstance.set(RTCStatus.STATUS_MAP.REMOTE_STREAM_SUCCESS); // 远程端响应流信息
        return onGotRemoteStream && onGotRemoteStream(...args)
      },
    });

    this.mediaOptions = {
      ...this.mediaOptions,
      ...mediaOptions,
    };
    this.onLocalStreamSuccess = onLocalStreamSuccess;
    this.onLocalStreamInactive = onLocalStreamInactive;
    this.onLocalStreamError = onLocalStreamError;
    this.rtcStatusInstance = new RTCStatus({
      onChange: onStatusChange
    });
  }

  call = () => {
    const status = this.rtcStatusInstance.get();
    if (status !== RTCStatus.STATUS_MAP.UN_INIT && status !== RTCStatus.STATUS_MAP.CLOSED) {
      alert('通话中...')
      return;
    }

    this.rtcStatusInstance.set(RTCStatus.STATUS_MAP.START);

    this.localMedia = new LocalMedia({
      mediaOptions: this.mediaOptions,
      onStreamSuccess: this.onLocalStreamSuccess,
      onStreamError: this.onLocalStreamError,
      onStreamInactive: this.onLocalStreamInactive,
    });

    this.localMedia
      .create()
      .then(stream => {
        this.rtcStatusInstance.set(RTCStatus.STATUS_MAP.LOCAL_MEDIA_GOTED);
        this.localStream = stream;
        this._connectAndCreate();
      })
  }

  _connectAndCreate = () => {
    this.connect();
    this.create(this.localStream);
  }

  destroy = () => {
    const status = this.rtcStatusInstance.get();
    if (status === RTCStatus.STATUS_MAP.UN_INIT || status === RTCStatus.STATUS_MAP.CLOSED) {
      alert('目前无通话')
      return;
    }

    this.rtcStatusInstance.set(RTCStatus.STATUS_MAP.CLOSED);

    this.localMedia.stop();
    this.localMedia = null;

    this.close();
  }
}
