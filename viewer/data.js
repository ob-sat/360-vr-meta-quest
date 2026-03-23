var APP_DATA = {
  "scenes": [
    {
      "id": "0-reception-1",
      "name": "RECEPTION 1",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        }
      ],
      "faceSize": 1024,
      "initialViewParameters": {
        "yaw": 1.5331255383357307,
        "pitch": 0.007881372135507547,
        "fov": 1.2681200091521299
      },
      "linkHotspots": [
        {
          "yaw": 0.8553672960168122,
          "pitch": 0.036563435128837085,
          "rotation": 0,
          "target": "1-recruitment-zone-1"
        },
        {
          "yaw": 2.4087945297166087,
          "pitch": 0.035458794352869916,
          "rotation": 0,
          "target": "3-reception-2"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "1-recruitment-zone-1",
      "name": "RECRUITMENT ZONE 1",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        }
      ],
      "faceSize": 1024,
      "initialViewParameters": {
        "yaw": 0,
        "pitch": 0,
        "fov": 1.3926760049349705
      },
      "linkHotspots": [
        {
          "yaw": 1.6874649222614568,
          "pitch": 0.025648035268510228,
          "rotation": 0,
          "target": "0-reception-1"
        },
        {
          "yaw": 0.18566809952616126,
          "pitch": 0.04544985450976213,
          "rotation": 0,
          "target": "2-recruitment-zone-2"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "2-recruitment-zone-2",
      "name": "RECRUITMENT ZONE 2",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        }
      ],
      "faceSize": 1024,
      "initialViewParameters": {
        "yaw": 0.6954465788715876,
        "pitch": 0.012946523286252898,
        "fov": 1.3926760049349705
      },
      "linkHotspots": [
        {
          "yaw": 0.03935997489929477,
          "pitch": 0.06213929283171993,
          "rotation": 0,
          "target": "1-recruitment-zone-1"
        },
        {
          "yaw": -1.747233670134591,
          "pitch": 0.09152937512857662,
          "rotation": 0,
          "target": "3-reception-2"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "3-reception-2",
      "name": "RECEPTION 2",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        }
      ],
      "faceSize": 1024,
      "initialViewParameters": {
        "yaw": 0.0970017895884201,
        "pitch": 0.05836939163560295,
        "fov": 1.2681200091521299
      },
      "linkHotspots": [
        {
          "yaw": 0.634485477925578,
          "pitch": 0.06731208599376437,
          "rotation": 0,
          "target": "2-recruitment-zone-2"
        },
        {
          "yaw": -0.9777640866033579,
          "pitch": 0.055427078684363806,
          "rotation": 0,
          "target": "0-reception-1"
        },
        {
          "yaw": 2.1643661310424687,
          "pitch": 0.1048459303393372,
          "rotation": 0,
          "target": "4-visitor-lounge-1"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "4-visitor-lounge-1",
      "name": "VISITOR LOUNGE 1",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        }
      ],
      "faceSize": 1024,
      "initialViewParameters": {
        "yaw": 0.4190072973903778,
        "pitch": 0.028170814626033547,
        "fov": 1.3926760049349705
      },
      "linkHotspots": [
        {
          "yaw": 0.9351648383225601,
          "pitch": 0.05736812537847058,
          "rotation": 0,
          "target": "5-visitor-lounge-2"
        },
        {
          "yaw": -2.229762854840576,
          "pitch": 0.0763057054622287,
          "rotation": 0,
          "target": "3-reception-2"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "5-visitor-lounge-2",
      "name": "VISITOR LOUNGE 2",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        }
      ],
      "faceSize": 1024,
      "initialViewParameters": {
        "yaw": 0.36720081291748485,
        "pitch": -0.01786445131279457,
        "fov": 1.324573380049428
      },
      "linkHotspots": [
        {
          "yaw": -0.22476119053513877,
          "pitch": 0.060875759457379885,
          "rotation": 0,
          "target": "4-visitor-lounge-1"
        }
      ],
      "infoHotspots": []
    }
  ],
  "name": "Project Title",
  "settings": {
    "mouseViewMode": "drag",
    "autorotateEnabled": false,
    "fullscreenButton": false,
    "viewControlButtons": false
  }
};
