/**
 * UdioPlayer.js
 * A JavaScript library for game developers to search and play audio from Udio's API
 * @version 1.0.0
 * @author AI Assistant
 * @license MIT
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    // Node. Does not work with strict CommonJS, but
    // only CommonJS-like environments that support module.exports,
    // like Node.
    module.exports = factory();
  } else {
    // Browser globals (root is window)
    root.UdioPlayer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  /**
   * @typedef {Object} UdioAudioOptions
   * @property {number} [volume=1.0] - Volume level between 0.0 and 1.0
   * @property {boolean} [autoplay=false] - Whether to autoplay the audio when loaded
   * @property {boolean} [loop=false] - Whether to loop the audio
   * @property {number} [playbackRate=1.0] - Playback rate (0.5 to 4.0)
   */

  /**
   * @typedef {Object} UdioLoopOptions
   * @property {number} startTime - Start time in seconds
   * @property {number} endTime - End time in seconds
   * @property {number} [repetitions] - Number of times to repeat the loop (undefined = infinite)
   */
  
  /**
   * @typedef {Object} UdioSearchOptions
   * @property {string[]} [tags] - Tags to search for
   * @property {string} [searchTerm] - Direct search term
   * @property {number} [maxResults=10] - Maximum number of results to return
   * @property {string} [sort=null] - Sort method ("likes", "cache_trending_score", etc.)
   * @property {number} [maxAgeInHours] - Maximum age of tracks in hours
   * @property {string} [userId] - Specific user ID to search from
   */

  /**
   * @typedef {Object} UdioTrack
   * @property {string} id - Track ID
   * @property {string} artist - Artist name
   * @property {string} title - Track title
   * @property {string} url - Track URL
   * @property {string[]} tags - Track tags
   * @property {string} [image] - Track image URL
   * @property {number} [duration] - Track duration in seconds
   * @property {string} [lyrics] - Track lyrics
   */

  // Private variables and methods
  const CORS_PROXY = 'https://corsproxy.io/?';
  
  // Main class
  class UdioPlayer {
    /**
     * Creates a new UdioPlayer instance
     * @param {Object} [options] - Configuration options
     * @param {string} [options.apiEndpoint='https://www.udio.com/api/songs/search'] - Udio API endpoint
     * @param {boolean} [options.useCorsProxy=true] - Whether to use CORS proxy for requests
     * @param {number} [options.pageSize=20] - Number of results per page
     */
    constructor(options = {}) {
      this.apiEndpoint = options.apiEndpoint || 'https://www.udio.com/api/songs/search';
      this.useCorsProxy = options.useCorsProxy !== false;
      this.pageSize = options.pageSize || 20;
      
      this._activeAudio = null;
      this._audioElement = null;
      this._currentTrack = null;
      this._loopTimer = null;
      this._loopOptions = null;
      this._loopCount = 0;
      this._eventListeners = {};
    }

    /**
     * Search for tracks in Udio's API
     * @param {UdioSearchOptions} [options] - Search options
     * @returns {Promise<UdioTrack[]>} Array of matching tracks
     */
    async search(options = {}) {
      const searchQuery = {
        sort: options.sort || null,
        maxAgeInHours: options.maxAgeInHours || 168, // 1 week default
        searchTerm: options.searchTerm || '',
      };
      
      if (options.tags && options.tags.length > 0) {
        searchQuery.containsTags = options.tags;
      }
      
      if (options.userId) {
        searchQuery.userId = options.userId;
      }

      const postData = JSON.stringify({
        searchQuery: searchQuery,
        pageParam: options.page || 0,
        pageSize: options.maxResults || this.pageSize
      });
      
      try {
        const url = this.useCorsProxy ? `${CORS_PROXY}${encodeURIComponent(this.apiEndpoint)}` : this.apiEndpoint;
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: postData
        });

        if (!response.ok) {
          throw new Error(`API request failed with status ${response.status}`);
        }

        const result = await response.json();
        
        return result.data.map(song => ({
          id: song.id,
          artist: song.artist,
          title: song.title,
          url: song.song_path,
          tags: song.tags,
          image: song.image_path,
          duration: song.duration,
          lyrics: song.lyrics,
          publishedAt: song.published_at,
          likes: song.likes,
          plays: song.plays
        }));
      } catch (error) {
        console.error('Error searching Udio:', error);
        throw error;
      }
    }

    /**
     * Get a single track by matching keywords/tags
     * @param {string|string[]} keywords - Keywords or tags to search for
     * @param {UdioSearchOptions} [options] - Additional search options
     * @returns {Promise<UdioTrack|null>} A matching track or null if none found
     */
    async getTrack(keywords, options = {}) {
      const searchOptions = { ...options };
      
      if (typeof keywords === 'string') {
        searchOptions.searchTerm = keywords;
      } else if (Array.isArray(keywords)) {
        searchOptions.tags = keywords;
      }
      
      searchOptions.maxResults = 1;
      
      const tracks = await this.search(searchOptions);
      return tracks.length > 0 ? tracks[0] : null;
    }

    /**
     * Load and prepare a track for playback
     * @param {UdioTrack|string} track - Track object or URL to load
     * @param {UdioAudioOptions} [options] - Audio options
     * @returns {Promise<HTMLAudioElement>} The audio element
     */
    async loadTrack(track, options = {}) {
      // Clean up any existing audio
      this.stop();
      
      let trackUrl;
      if (typeof track === 'string') {
        trackUrl = track;
        this._currentTrack = { url: track };
      } else {
        trackUrl = track.url;
        this._currentTrack = track;
      }
      
      // Create new audio element
      this._audioElement = new Audio();
      
      // Apply options
      this._audioElement.volume = options.volume !== undefined ? options.volume : 1.0;
      this._audioElement.loop = options.loop === true;
      this._audioElement.autoplay = options.autoplay === true;
      
      if (options.playbackRate) {
        this._audioElement.playbackRate = options.playbackRate;
      }
      
      // Set up event listeners
      this._setupEventListeners();
      
      // Load the track
      try {
        const url = this.useCorsProxy ? `${CORS_PROXY}${encodeURIComponent(trackUrl)}` : trackUrl;
        this._audioElement.src = url;
        await this._audioElement.load();
        return this._audioElement;
      } catch (error) {
        console.error('Error loading track:', error);
        throw error;
      }
    }

    /**
     * Play a track based on keywords or directly by URL/object
     * @param {string|string[]|UdioTrack} input - Keywords, tags, track object or URL
     * @param {UdioAudioOptions} [options] - Audio options
     * @returns {Promise<HTMLAudioElement>} The audio element
     */
    async play(input, options = {}) {
      let track;
      
      // If input is a string or array, search for matching track
      if (typeof input === 'string' && input.startsWith('http')) {
        track = { url: input };
      } else if (typeof input === 'string' || Array.isArray(input)) {
        track = await this.getTrack(input);
        if (!track) {
          throw new Error('No matching track found');
        }
      } else {
        track = input;
      }
      
      // Load and automatically play the track
      const playOptions = { ...options, autoplay: true };
      await this.loadTrack(track, playOptions);
      
      return this._audioElement;
    }

    /**
     * Pause playback of current track
     */
    pause() {
      if (this._audioElement) {
        this._audioElement.pause();
      }
    }

    /**
     * Resume playback of current track
     */
    resume() {
      if (this._audioElement) {
        this._audioElement.play().catch(error => {
          console.error('Error resuming playback:', error);
        });
      }
    }

    /**
     * Stop playback and unload current track
     */
    stop() {
      this._clearLoopTimer();
      
      if (this._audioElement) {
        this._audioElement.pause();
        this._audioElement.src = '';
        this._removeEventListeners();
        this._audioElement = null;
      }
      
      this._currentTrack = null;
    }

    /**
     * Set volume level
     * @param {number} level - Volume level between 0.0 and 1.0
     */
    setVolume(level) {
      if (this._audioElement && level >= 0 && level <= 1) {
        this._audioElement.volume = level;
      }
    }

    /**
     * Get current volume level
     * @returns {number} Current volume (0.0 to 1.0)
     */
    getVolume() {
      return this._audioElement ? this._audioElement.volume : 0;
    }

    /**
     * Set playback rate
     * @param {number} rate - Playback rate (0.5 to 4.0)
     */
    setPlaybackRate(rate) {
      if (this._audioElement && rate >= 0.5 && rate <= 4.0) {
        this._audioElement.playbackRate = rate;
      }
    }

    /**
     * Get current playback rate
     * @returns {number} Current playback rate
     */
    getPlaybackRate() {
      return this._audioElement ? this._audioElement.playbackRate : 1.0;
    }

    /**
     * Set current playback position
     * @param {number} seconds - Position in seconds
     */
    seek(seconds) {
      if (this._audioElement) {
        this._audioElement.currentTime = Math.max(0, Math.min(seconds, this._audioElement.duration));
      }
    }

    /**
     * Get current playback position
     * @returns {number} Current position in seconds
     */
    getCurrentTime() {
      return this._audioElement ? this._audioElement.currentTime : 0;
    }

    /**
     * Get track duration
     * @returns {number} Duration in seconds
     */
    getDuration() {
      return this._audioElement ? this._audioElement.duration : 0;
    }

    /**
     * Set loop mode
     * @param {boolean} enabled - Whether to enable looping
     */
    setLoop(enabled) {
      if (this._audioElement) {
        this._clearLoopTimer();
        this._audioElement.loop = enabled;
      }
    }

    /**
     * Loop a specific section of the track
     * @param {UdioLoopOptions} options - Loop options
     */
    loopSection(options) {
      if (!this._audioElement) return;
      
      this._clearLoopTimer();
      
      // Disable standard loop
      this._audioElement.loop = false;
      
      // Store loop options
      this._loopOptions = {
        startTime: options.startTime,
        endTime: options.endTime,
        repetitions: options.repetitions
      };
      
      this._loopCount = 0;
      
      // Start loop
      this._setupLoopHandler();
      
      // Jump to loop start point if we're not already in the loop
      if (this._audioElement.currentTime < options.startTime || this._audioElement.currentTime > options.endTime) {
        this._audioElement.currentTime = options.startTime;
      }
    }

    /**
     * Cancel section looping
     */
    cancelLoopSection() {
      this._clearLoopTimer();
      this._loopOptions = null;
    }

    /**
     * Add an event listener
     * @param {string} event - Event name (play, pause, ended, timeupdate, etc)
     * @param {Function} callback - Callback function
     */
    addEventListener(event, callback) {
      if (!this._eventListeners[event]) {
        this._eventListeners[event] = [];
      }
      this._eventListeners[event].push(callback);
      
      if (this._audioElement) {
        this._audioElement.addEventListener(event, callback);
      }
    }

    /**
     * Remove an event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback function to remove
     */
    removeEventListener(event, callback) {
      if (this._eventListeners[event]) {
        this._eventListeners[event] = this._eventListeners[event].filter(cb => cb !== callback);
      }
      
      if (this._audioElement) {
        this._audioElement.removeEventListener(event, callback);
      }
    }

    /**
     * Get current track information
     * @returns {UdioTrack|null} Current track or null if none loaded
     */
    getCurrentTrack() {
      return this._currentTrack;
    }

    /**
     * Search for tracks by genre
     * @param {string} genre - Genre to search for
     * @param {UdioSearchOptions} [options] - Additional search options
     * @returns {Promise<UdioTrack[]>} Array of matching tracks
     */
    async searchByGenre(genre, options = {}) {
      return this.search({
        ...options,
        tags: [genre]
      });
    }

    /**
     * Play a random track that matches the specified genre
     * @param {string} genre - Genre to search for
     * @param {UdioAudioOptions} [options] - Audio options
     * @returns {Promise<HTMLAudioElement>} The audio element
     */
    async playRandomByGenre(genre, options = {}) {
      const tracks = await this.searchByGenre(genre, { maxResults: 10 });
      
      if (!tracks || tracks.length === 0) {
        throw new Error(`No tracks found for genre: ${genre}`);
      }
      
      const randomIndex = Math.floor(Math.random() * tracks.length);
      return this.play(tracks[randomIndex], options);
    }

    // Private methods
    _setupEventListeners() {
      if (!this._audioElement) return;
      
      // Add stored event listeners to new audio element
      for (const [event, callbacks] of Object.entries(this._eventListeners)) {
        for (const callback of callbacks) {
          this._audioElement.addEventListener(event, callback);
        }
      }
    }

    _removeEventListeners() {
      if (!this._audioElement) return;
      
      // Remove all event listeners
      for (const [event, callbacks] of Object.entries(this._eventListeners)) {
        for (const callback of callbacks) {
          this._audioElement.removeEventListener(event, callback);
        }
      }
    }

    _clearLoopTimer() {
      if (this._loopTimer) {
        clearInterval(this._loopTimer);
        this._loopTimer = null;
      }
    }

    _setupLoopHandler() {
      if (!this._audioElement || !this._loopOptions) return;
      
      this._clearLoopTimer();
      
      // Check every 50ms if we need to loop
      this._loopTimer = setInterval(() => {
        if (!this._audioElement || !this._loopOptions) return;
        
        const { startTime, endTime, repetitions } = this._loopOptions;
        
        // If we've reached the end of the loop section
        if (this._audioElement.currentTime >= endTime) {
          // If repetitions is defined, check if we've exceeded the limit
          if (repetitions !== undefined) {
            this._loopCount++;
            
            if (this._loopCount >= repetitions) {
              // Cancel looping and let playback continue
              this._clearLoopTimer();
              this._loopOptions = null;
              return;
            }
          }
          
          // Jump back to start of loop
          this._audioElement.currentTime = startTime;
        }
      }, 50);
    }
  }

  // Public API
  return UdioPlayer;
});