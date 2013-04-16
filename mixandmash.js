(function($){
	$.fn.mixandmash = function(settings){
    var calling_div = this;

    var defaults = {
      // This is the master queue of videos to play,
      //  it will be broken down in to per buffer queues
      queue : new Array (
        { id: 'Qe500eIK1oA', startSeconds: '122', endSeconds: '125' },
        { id: 'Zi_XLOBDo_Y', startSeconds: '126', endSeconds: '130' }
      ),
      autostart : true,                 // play on load
      levels_of_buffering : 3,          // number of backbuffers to utilize
      opt_preplay : false,               // start backbuffer playback earlier to better synchronize transition
      opt_leadin_time : 500,            // how long a leadin to use for backbuffer
      opt_seek_is_free: false,           // presume seeking in a buffered clip is cheap
      hack_maximum_back_buffer: true,   // hack to correct a bookkeeping error due to strange behavior from player.getCurrentTime
      ytplayer_vars : {
        height: '480',
        width: '640',
        playerVars: {
           autoplay: false,
           enablejsapi: false,
           loop: false,
           rel: false
        },
        events: {
          'onReady': onPlayerReady,
          'onStateChange': onPlayerStateChange,
          'onError': onPlayerError
        }
      }
    };

		settings = $.extend(true,defaults,settings);

		if ( settings.hack_maximum_back_buffer ) {
		  settings.levels_of_buffering = settings.queue.length; }

    var buffers = [];
    var num_buffers_ready = 0;
    var active_buffer_id = 0;
    var playerID_to_bufferID_map = [ ];

    var volume_level;
    var is_muted;

    var total_clips_played = 0;
    var youtube_available = false;

    // Create a collection of divs for background loading
    var div_player = calling_div[0];
    for ( var i = 0; i < settings.levels_of_buffering; ++i ) {
      var div;
      if ( i == 0 ) {
        // The first buffer corresponds to one created by the caller
        div = div_player;
      }
      else {
        var new_name = div_player.id+ i;
        div = jQuery.clone(div_player);
        div.id = new_name;
        document.body.appendChild( div );

        // BUG: Can not hide this div because YTPlayer will never call onready
        // div.hide();
      }

      buffers[i] = {
        id : i,
        div : div,
        queue: new Array,
        playingPosition : 0,
        enqueuePosition : 0,
      };

      // build queues
      for ( var j = i; j < settings.queue.length; j = j + settings.levels_of_buffering ) {
        buffers[i].queue.push( settings.queue[j] );
      }
    }

    // Load YT IFrame Player API code
    $.getScript( 'http://www.youtube.com/player_api', function() { youtube_available = true; }  );

    // Clean timeout for YouTube failure
    setTimeout( function() {
        if( !youtube_available ) {
          $.log("Error: Youtube is not available!");
        }
      },
      5000
      );

    // YT Frames callback
    // create all backbuffers
    function onYouTubePlayerAPIReady() {
      for ( var i = 0; i < settings.levels_of_buffering; ++i ) {
        if ( buffers[i].queue[0] ) {
          var name = calling_div[0].id;
          if ( i != 0 ) { name = name + i; }

          settings.ytplayer_vars.videoId = buffers[i].queue[0].id;
          settings.ytplayer_vars.playerVars.start = buffers[i].queue[0].startSeconds;

          buffers[i].player = new YT.Player(name, settings.ytplayer_vars);

          playerID_to_bufferID_map[buffers[i].player.id] = i;
          $.log("MAP: PlayerID: " + buffers[i].player.id + " = BufferID: " + i);
        }
      }

      // Warn if all buffers fail to load
      setTimeout( function() {
          if ( num_buffers_ready != settings.levels_of_buffering ) {
            $.log("Error: Not all buffers are ready, cannot begin playing")
          }
        },
        3000 
        );
    }

    // YT API will call this function when buffer is ready
    function onPlayerReady(event) {
      // Hide and mute all buffers that aren't the first
      if ( event.target.id != buffers[0].player.id ) {
        jQuery(buffers[playerID_to_bufferID_map[event.target.id]].div).hide();
        if ( settings.opt_preplay ) {
          event.target.mute();
        }
      }

      ++num_buffers_ready;
      if ( num_buffers_ready == settings.levels_of_buffering &&  settings.autostart ) {
        settings.autostart = false;

        buffers[0].player.playVideo();
        if ( settings.opt_preplay ) {
          volume_level = buff.player.getVolume();
          is_muted = buff.player.isMuted();
        }
      }
    }

    // YT API will call this function when a buffer's state changes
    function onPlayerStateChange(event) {
      $.log("onPlayerStateChange for PlayerID: " + event.target.id + " event: " + event.data);
      var buff_id = playerID_to_bufferID_map[event.target.id];
      if ( buff_id == active_buffer_id ) {
        var buff = buffers[buff_id];
        if (event.data == YT.PlayerState.PLAYING ) {
          // create finishing timer
          // only created once
          if ( !buff.hasTimer ) {
            buff.hasTimer = true;

            var timeout = 1000 * (buff.queue[buff.playingPosition].endSeconds - buff.queue[buff.playingPosition].startSeconds);
            $.log("Buff: " + buff.id + " rocking out for: " + timeout + "ms! currentTime: " + event.target.getCurrentTime());
            buff.intendedStopTime = event.target.getCurrentTime() + (timeout / 1000);
            buff.lastTimeout = timeout;
            setTimeout( function() { stopPlayerVideo(buff.id); },
                timeout);

            if ( settings.opt_preplay ) {
              setTimeout( function() { preplay(buff.id); }, timeout - settings.opt_leadin_time );
              $.log("Preplay scheduled: BufferID: " + buff.id + " preplay time: " + timeout - settings.opt_leadin_time + "ms!");
            }
          }
        }
      }
    }

    function preplay(id) {
      var buff = buffers[id];

      var idNextBuff = (id + 1) % settings.levels_of_buffering;
      var nextBuff = buffers[idNextBuff];
      var nextBuffQueueEntry = nextBuff.queue[nextBuff.enqueuePosition];
      if ( nextBuffQueueEntry ) {

        // if the clip has not reached it's near end point, reschedule the timer
        var currtime = buff.player.getCurrentTime()
          if ( buff.intendedStopTime - settings.opt_leadin_time/1000 > currtime )
          {
            var timeout = 1000 * ( buff.intendedStopTime - currtime ) - settings.opt_leadin_time;
            $.log("Preplay rescheduled: BufferID: " + id + " preplay time: " + timeout + "ms! (since intendedStopTime: " + buff.intendedStopTime - settings.opt_leadin_time+ " >  currentTime: " + currtime + ")");

            setTimeout(
                function() { preplay(id); },
                timeout);
            return;
          }


        var timeUntilActiveClipFinishesSeconds = buff.intendedStopTime - currtime;
        var startTime = nextBuffQueueEntry.startSeconds - timeUntilActiveClipFinishesSeconds;
        if ( startTime < 0 ) {
          // Not enough time for leadin
          return;
        }

        nextBuff.player.mute();
        nextBuff.player.seekTo( startTime );
        nextBuff.player.playVideo();

        $.log("Preplaying BufferID: " + id + " preplay time: " + startTime + "s!");
      }
    }

    function queueNextVideo (id) {
      $.log("Queue on BufferID: " + id + "!");
      var nextBuff = buffers[id];
      ++nextBuff.enqueuePosition;

      // The first clip for a buffer was enqueued creation
      var nextBuffQueueEntry = nextBuff.queue[nextBuff.enqueuePosition];
      if ( nextBuffQueueEntry ) {
        // HACK: Attempting to trigger proper cue video behavior by showing parent div
        jQuery(nextBuff.div).show();
        if ( settings.opt_preplay ) {
          nextBuff.player.mute();
        }
        nextBuff.player.cueVideoById( nextBuffQueueEntry.id, nextBuffQueueEntry.startSeconds);
        $.log("Queued on BufferID: " + id + " iri: " + nextBuffQueueEntry.id + "!");
        jQuery(nextBuff.div).hide();
      }
      else {
        $.log("Emptied queue on BufferID: " + id + "!");
      }
    }

    // BUG: This callback is not evaluated entirely on each invocation and hence it creates incorrect timers
    function stopPlayerVideo(id) {
      $.log("stopPlayerVideo for bufferID: " + id);
      var buff = buffers[id];

      var idNextBuff = (id + 1) % settings.levels_of_buffering;
      var nextBuff = buffers[idNextBuff];

      // if the clip has not reached it's end point, reschedule the timer
      var currtime = buff.player.getCurrentTime()
      if ( buff.intendedStopTime > currtime )
      {
        var timeout = 1000 * ( buff.intendedStopTime - currtime );

        // BUG: There is a bug with bookkeeping due to currenttime
        var doAdjust = true;
        if ( buff.lastTimeout && buff.lastTimeout <= timeout )
        {
          doAdjust = false;
        }

        if ( doAdjust ) {
          buff.lastTimeout = timeout;
          $.log("BufferID: " + id + " rocking out for another: " + timeout + "ms! (since intendedStopTime: " + buff.intendedStopTime + " >  currentTime: " + currtime + ")");
          setTimeout(
              function() { stopPlayerVideo(id); },
              timeout);
          return;
        }

      }

      if ( settings.opt_preplay ) {
        volume_level = buff.player.getVolume();
        is_muted = buff.player.isMuted();
      }

      // pause the video, in the offhand chance that we want more buffered data later
      buff.player.pauseVideo();
      ++buff.playingPosition;
      if ( buff.hasTimer ) {
        buff.hasTimer = false;
      }

      ++total_clips_played;
      if ( total_clips_played < settings.queue.length ) {
        jQuery(buff.div).hide();
        jQuery(nextBuff.div).show();
        // This does not work in Firefox, the video needs user intervention
        if ( !nextBuff.player )
        {
          $.log("Fatal error: Youtube Player not loading");
          return calling_div;
        }
        else {
          $.log("Playing BufferID: " + nextBuff.id );
          if ( settings.opt_preplay && settings.opt_seek_is_free ) {
            nextBuff.player.setVolume( volume_level );
            is_muted ? nextBuff.player.mute() : nextBuff.player.unMute();
            nextBuff.player.seekTo(nextBuff.queue[nextBuff.enqueuePosition].startSeconds);
          }
          nextBuff.player.playVideo();
          active_buffer_id = idNextBuff;
          queueNextVideo(id);
        }
      }
    }

    function onPlayerError(error) {
      $.log("Error: Something is amiss. error: " + error);
      $.log("Check here for answer: http://code.google.com/apis/youtube/iframe_api_reference.html");
    }

		// Hijack the event
		if(!window.onYouTubePlayerAPIReady)
		{				
			window.onYouTubePlayerAPIReady = function(playerID){
			  onYouTubePlayerAPIReady();
			}
		}

		return calling_div;
	}
})(jQuery);
