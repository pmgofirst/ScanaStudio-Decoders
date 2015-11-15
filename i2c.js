
/*
*************************************************************************************

						     SCANASTUDIO 2 I2C DECODER

The following commented block allows some related informations to be displayed online

<DESCRIPTION>

	I2C Protocol Decoder.
	A standard  decoder of Phillips (NXP) multi-master serial single-ended computer bus.

</DESCRIPTION>

<RELEASE_NOTES>

	V1.60: More realistic demo signals generation
	V1.59: Added more decoder trigger options.
	V1.58: Added decoder trigger
	V1.57: Added demo signal builder
	V1.56: Fixed ACK missing display bug
	V1.55: Solved major decoding bug
	V1.54: Prevented incompatible workspaces from using this decoder
	V1.53: Now the decoding can be aborted
	V1.52: Removed Deprecated parts. Fixed bug with very slow i2c signals.
	V1.50: Added new error messages. Bug fixes.
	V1.45: A lot of bugs fixes. Performance improvements.
	V1.40: UI improvements. New scl frequency option
	V1.35: Added Packet/Hex View support
	V1.30: Performance optimizations. Decoding time decreased by half
	V1.25: Visual improvements. Added signal noise handling
	V1.20: Some user error messages removed
	V1.15: Bug fixes
	V1.10: A bunch of small compatibility fixes
	V1.00: Initial release

</RELEASE_NOTES>

<AUTHOR_URL>

	mailto:v.kosinov@ikalogic.com

</AUTHOR_URL></AUTHOR_URL>
						
*************************************************************************************
*/


/* The decoder name as it will apear to the users of this script
*/
function get_dec_name()
{
	return "I2C";
}


/* The decoder version 
*/
function get_dec_ver()
{
	return "1.60";
}


/* Author 
*/
function get_dec_auth()
{
	return "IKALOGIC";
}


/* Graphical user interface for this decoder
*/
function gui()
{
	ui_clear();
	
	if ((typeof(get_device_max_channels) == 'function') && (typeof(get_device_name) == 'function'))
	{
		// Prevented incompatible workspaces from using the decoder
		if( get_device_max_channels() < 2 )
		{
			ui_add_info_label("This device (or workspace configuration) do not have enough channels for this decoder to operate properly");
			return;
		}
	}
	else
	{
		ui_add_info_label("error", "Please update your ScanaStudio software to use this decoder version");
		return;
	}

	ui_add_ch_selector("chSda", "(SDA) Serial Data", "SDA");
	ui_add_ch_selector("chScl", "(SCL) Serial Clock", "SCL");

	ui_add_txt_combo("adrShow", "Show slave address as");
		ui_add_item_to_txt_combo("address and separate R/W flag", true);
		ui_add_item_to_txt_combo("address including R/W flag");

	ui_add_separator();
	ui_add_info_label("<b>Hex view options:</b>");
	
	ui_add_txt_combo("hexView", "Include in HEX view:");
		ui_add_item_to_txt_combo("DATA fields only", true);
		ui_add_item_to_txt_combo("ADDRESS fields only", false);
		ui_add_item_to_txt_combo("Everything", false);
}

/* Constants 
*/
var I2COBJECT_TYPE =
{
	START : 0x01,
	STOP  : 0x02,
	BYTE  : 0x04,
	ACK   : 0x08,
	NOISE : 0x10
};

var I2C_ADDRESS =
{
	GENERAL_CALL : 0x00,
	START  		 : 0x00,
	CBUS  	     : 0x01,
	TENBITS      : 0x78
};

var I2C_ERR_CODES = 
{
	OK         : 0x01,
	NO_SIGNAL  : 0x02,
	ERR_SIGNAL : 0x04,
};

var I2C_NOISE = 
{
	SDA : 0x01,
	SCL : 0x02
};

var HEXVIEW_OPT = 
{
	DATA : 0x00,
	ADR  : 0x01,
	ALL  : 0x02
}; 

var I2C_RW_BIT_MASK = 0x01;

var I2C_MAX_FREQ_MHZ = 5;
var I2C_MAX_FREQ_HZ = (I2C_MAX_FREQ_MHZ * 1000) * 1000;
var I2C_MIN_T = 1 / I2C_MAX_FREQ_HZ;


/* Object definitions
*/
function I2cObject (type, value, start, end, count)
{
	this.type = type;
	this.value = value;
	this.start = start;
	this.end = end;
	this.count = count;
};

function i2c_trig_step_t (sda, scl)
{
	this.sda = sda;
	this.scl = scl;
};


/* Global variables
*/
var i2cObjectsArr;
var AvgtHigh;

var PKT_COLOR_DATA;
var PKT_COLOR_DATA_TITLE;
var PKT_COLOR_START_TITLE;
var PKT_COLOR_ADR_TITLE;
var PKT_COLOR_ACK_TITLE;
var PKT_COLOR_NACK_TITLE;
var PKT_COLOR_STOP_TITLE;
var PKT_COLOR_NOISE_TITLE;

/* 	I2C Trigger generator variables
*/
var i2c_trig_steps = [];

/* This is the function that will be called from ScanaStudio
   to update the decoded items
*/
function decode()
{
	get_ui_vals();			// Update the content of all user interface related variables
	clear_dec_items();		// Clears all the the decoder items and its content

	i2cObjectsArr = new Array();

	PKT_COLOR_DATA        = get_ch_light_color(chSda);
	PKT_COLOR_DATA_TITLE  = dark_colors.gray;
	PKT_COLOR_START_TITLE = dark_colors.orange;
	PKT_COLOR_ADR_TITLE   = dark_colors.yellow;
	PKT_COLOR_ACK_TITLE   = dark_colors.green;
	PKT_COLOR_NACK_TITLE  = dark_colors.red;
	PKT_COLOR_STOP_TITLE  = dark_colors.blue;
	PKT_COLOR_NOISE_TITLE = dark_colors.black;

	if (!check_scanastudio_support())
    {
        add_to_err_log("Please update your ScanaStudio software to the latest version to use this decoder");
        return;
    }

	var errSig = test_signal();

	if (errSig == I2C_ERR_CODES.ERR_SIGNAL)
	{
		add_to_err_log("Error. Selected channels doesn't have any valid I2C signal");
		return false;
	}
	else if (errSig == I2C_ERR_CODES.NO_SIGNAL)
	{
		return false;
	}

	decode_signal();
	
	var i2cObjCnt = 0;
	var i2cObject = 0;
	var firstIter = true;
	var rwBit = 0;
	var addrStr = "";

	var pktDataStart = 0, pktDataEnd = 0;
	var pktDataFirst = true;
	var pktDataStr = "";
	var pktDataCnt = 0;
	
	while (i2cObjectsArr.length > i2cObjCnt)
	{
		i2cObject = i2cObjectsArr[i2cObjCnt];
		i2cObjCnt++;
	
	    if (abort_requested() == true)
		{
			return false;
		}

		switch (i2cObject.type)
		{
			case I2COBJECT_TYPE.START:

					if (i2cObject.start > (AvgtHigh / 2))
					{
						dec_item_new(chSda, (i2cObject.start - (AvgtHigh / 2)), i2cObject.start + (AvgtHigh / 2));
					}
					else
					{
						dec_item_new(chSda, (i2cObject.start - (AvgtHigh / 6)), i2cObject.start + (AvgtHigh / 6));
					}

					dec_item_add_pre_text("MASTER START CONDITION");
					dec_item_add_pre_text("START CONDITION");
					dec_item_add_pre_text("START");
					dec_item_add_pre_text("ST");
					dec_item_add_comment("MASTER START CONDITION");

					if (!firstIter)
					{
						if (pktDataCnt > 0)
						{
							add_pkt_data(pktDataStart, pktDataEnd, pktDataStr, pktDataCnt);
							pktDataStr = "";
							pktDataFirst = true;
							pktDataCnt = 0;
						}

						pkt_end();
					}

					pkt_start("I2C");
					pkt_add_item(-1, -1, "START", "", PKT_COLOR_START_TITLE, PKT_COLOR_DATA, true);
					firstIter = false;
			break;

			case I2COBJECT_TYPE.STOP:

					dec_item_new(chSda, (i2cObject.start - (AvgtHigh / 2)), i2cObject.start + (AvgtHigh / 2));
					dec_item_add_pre_text("MASTER STOP CONDITION");
					dec_item_add_pre_text("STOP CONDITION");
					dec_item_add_pre_text("STOP");
					dec_item_add_pre_text("SP");
					dec_item_add_comment("MASTER STOP CONDITION");

					if (pktDataCnt > 0)
					{
						add_pkt_data(pktDataStart, pktDataEnd, pktDataStr, pktDataCnt);
						pktDataStr = "";
						pktDataFirst = true;
						pktDataCnt = 0;
					}

					pkt_add_item(-1, -1, "STOP", "", PKT_COLOR_STOP_TITLE, PKT_COLOR_DATA, true);
			break;

			case I2COBJECT_TYPE.BYTE:

					if (i2cObject.count == 1)						// First byte after START condition - slave address
					{						
						var slaveAdr1 = i2cObject.value;			// Store slave address

						if (hexView != HEXVIEW_OPT.DATA)
						{
							hex_add_byte(chSda, i2cObject.start, i2cObject.end, slaveAdr1);
						}

						rwBit = (slaveAdr1 & I2C_RW_BIT_MASK);      // 1 - READ, 0 - WRITE
						slaveAdr1 >>= 1;							// Don't need R/W bit anymore
						var slaveAdrStr = "";						// String with slave address and/or his family code
						var slaveAdrStrShort = "";					// Shortened version

						if (rwBit == 0)
						{
							slaveAdrStr += "WRITE TO: ";
							slaveAdrStrShort += "WR ";
						}
						else
						{
							slaveAdrStr += "READ FROM: ";
							slaveAdrStrShort += "RD ";
						}

						if (slaveAdr1 == I2C_ADDRESS.GENERAL_CALL)
						{
							if (rwBit == 0)
							{
								slaveAdrStr = "GENERAL CALL ";
								slaveAdrStrShort = "GEN";
							}
							else
							{
								slaveAdrStr = "START BYTE";
								slaveAdrStrShort = "STBYTE";
							}

							dec_item_new(chSda, i2cObject.start, i2cObject.end);
							dec_item_add_pre_text(slaveAdrStr);
							dec_item_add_pre_text(slaveAdrStrShort);
						}
						else if (slaveAdr1 == I2C_ADDRESS.CBUS)
						{
							slaveAdrStr += "CBUS ADDRESS ";
							slaveAdrStrShort += "CBUS ";

							dec_item_new(chSda, i2cObject.start, i2cObject.end);
							dec_item_add_pre_text(slaveAdrStr + "(");
							dec_item_add_pre_text(slaveAdrStrShort);

							if (adrShow == 0)
							{
								dec_item_add_data(slaveAdr1);
								dec_item_add_post_text(" + R/W=" + rwBit + ")");
							}
							else
							{
								slaveAdr1 <<= 1;
								slaveAdr1 |= rwBit;
								dec_item_add_data(slaveAdr1);
								dec_item_add_post_text(")");
							}
						}
						else if ((slaveAdr1 & I2C_ADDRESS.TENBITS) >= I2C_ADDRESS.TENBITS)		// Slave 10 bits address
						{
							var i2cObjectAck = i2cObjectsArr[i2cObjCnt];
							i2cObjCnt++;
							var i2cObject2 = i2cObjectsArr[i2cObjCnt];							// Get second address byte
							i2cObjCnt++;

							var slaveAdr2 = i2cObject2.value;

							if (hexView != HEXVIEW_OPT.DATA)
							{
								hex_add_byte(chSda, i2cObject2.start, i2cObject2.end, slaveAdr2);
							}
	
							slaveAdr1 &= ~0x7C;								// Wipe undesired bits.
							var slaveAdr = slaveAdr2 | (slaveAdr1 << 10);	// Construct full 10 bits slave address

							dec_item_new(chSda, i2cObject.start, i2cObject.end);
							dec_item_add_pre_text(slaveAdrStr);

							if (adrShow == 0)
							{
								dec_item_add_data(slaveAdr);
								dec_item_add_post_text(" + R/W=" + rwBit + " (1st BYTE)");
							}
							else
							{
								slaveAdr <<= 1;
								slaveAdr |= rwBit;
								dec_item_add_data(slaveAdr);
								dec_item_add_post_text(" (1st BYTE)");
							}

							dec_item_new(chSda, i2cObject2.start, i2cObject2.end);
							dec_item_add_pre_text(slaveAdrStr);

							if (adrShow == 0)
							{
								dec_item_add_data(slaveAdr);
								dec_item_add_post_text(" + R/W=" + rwBit + " (2nd BYTE)");
							}
							else
							{
								slaveAdr <<= 1;
								slaveAdr |= rwBit;
								dec_item_add_data(slaveAdr);
								dec_item_add_post_text(" (2nd BYTE)");
							}

							addrStr = "(" + int_to_str_hex(slaveAdr) + ")";
							pkt_add_item(i2cObject.start, i2cObject2.end, "ADDRESS", slaveAdrStr + addrStr, PKT_COLOR_ADR_TITLE, PKT_COLOR_DATA, true);
						}
						else												// Classic 7-bits address
						{
							dec_item_new(chSda, i2cObject.start, i2cObject.end);
							dec_item_add_pre_text(slaveAdrStr);
							dec_item_add_pre_text(slaveAdrStrShort);

							if (adrShow == 0)
							{
								dec_item_add_data(slaveAdr1);
								dec_item_add_post_text(" + R/W=" + rwBit);
							}
							else
							{
								slaveAdr1 <<= 1;
								slaveAdr1 |= rwBit;
								dec_item_add_data(slaveAdr1);
							}
						}

						dec_item_add_comment(slaveAdrStr + "(" + int_to_str_hex(slaveAdr1) + ")");
						addrStr = int_to_str_hex(slaveAdr1);
						pkt_add_item(-1, -1, "ADDRESS", slaveAdrStr + addrStr, PKT_COLOR_ADR_TITLE, PKT_COLOR_DATA, true);
					}
					else		// Display normal data
					{
						var dataStr = int_to_str_hex(i2cObject.value);

						dec_item_new(chSda, i2cObject.start, i2cObject.end);
						dec_item_add_data(i2cObject.value);
						dec_item_add_comment(dataStr);

						pktDataStr += dataStr + " ";
						pktDataCnt++;

						if (pktDataFirst)
						{
							pktDataStart = i2cObject.start;
							pktDataFirst = false;
						}

						pktDataEnd = i2cObject.end;

						if (hexView != HEXVIEW_OPT.ADR)
						{
							hex_add_byte(chSda, -1, -1, i2cObject.value);
						}
					}
			break;

			case I2COBJECT_TYPE.ACK:

					if (i2cObject.value == 0)
					{
						dec_item_new(chSda, i2cObject.start, i2cObject.end);
					
						dec_item_add_pre_text("SLAVE ACKNOWLEDGE");
						dec_item_add_pre_text("ACKNOWLEDGE");
						dec_item_add_pre_text("ACK");
						dec_item_add_pre_text("A");
						dec_item_add_comment("SLAVE ACKNOWLEDGE");
					}
					else if (i2cObject.value == 1)
					{
						dec_item_new(chSda, i2cObject.start, i2cObject.end);

						dec_item_add_pre_text("SLAVE NO ACKNOWLEDGE");
						dec_item_add_pre_text("NO ACKNOWLEDGE");
						dec_item_add_pre_text("NACK");
						dec_item_add_pre_text("N");
						dec_item_add_comment("SLAVE NO ACKNOWLEDGE");
					}
					else
					{
						var prevI2cObject = i2cObjectsArr[i2cObjCnt - 1];
						var errMsgSt = prevI2cObject.end + AvgtHigh / 2;
						var errMsgEnd = errMsgSt + AvgtHigh;

						dec_item_new(chSda, errMsgSt, errMsgEnd);
						dec_item_add_pre_text("WARNING: NO ACKNOWLEDGE");
						dec_item_add_pre_text("WARN: NO ACK");
						dec_item_add_pre_text("!");
						dec_item_add_comment("WARNING: NO ACKNOWLEDGE");
					}
			break;

			case I2COBJECT_TYPE.NOISE:

					dec_item_new(chScl, (i2cObject.start - (AvgtHigh / 2)), i2cObject.start + (AvgtHigh / 2));

					if (i2cObject.value == I2C_NOISE.SDA)
					{
						dec_item_add_pre_text("NOISE ON SDA");
						dec_item_add_pre_text("!");
						dec_item_add_comment("NOISE ON SDA");
					}
					else
					{
						dec_item_add_pre_text("NOISE ON SCL");
						dec_item_add_pre_text("!");
						dec_item_add_comment("NOISE ON SCL");
					}
			break;
		}
	}

	if (pktDataCnt > 0)
	{
		add_pkt_data(pktDataStart, pktDataEnd, pktDataStr, pktDataCnt);
	}

	pkt_end();
	return true;
}


/* Find all I2C bus data then put all in one storage place (global array) 
   for future bus analysing in main function - decode()
*/
function decode_signal()
{
	var startStopArr = new Array();							// Array of START / STOP conditions in chronological order

	var trSda = trs_get_first(chSda);						// Position the navigator for sda/scl channels at the first transition
	var trScl = trs_get_first(chScl);
	var trSdaPrev = trSda;
	var noiseSda = false, noiseScl = false;
	var sclSemiPeriod = 0;

	AvgtHigh = get_avg_thigh(trScl);						// Get average high time of SCL signal (1/2 of period)

	trSda = trs_get_first(chSda);
	trScl = trs_get_first(chScl);

	while (trs_is_not_last(chSda) != false)					// Find all START and STOP conditions
	{
		if (abort_requested() == true)						// Allow the user to abort this script
		{
			return false;
		}

		var valScl = sample_val(chScl, trSda.sample);
		var type;

		if (valScl == 1)
		{
			if (get_tr_diff_us(trScl, trSda) > 10)
			{
				if (trSda.val == FALLING)
				{
					type = I2COBJECT_TYPE.START;
				}
				else
				{
					type = I2COBJECT_TYPE.STOP;
				}

				startStopArr.push(new I2cObject(type, true, trSda.sample, false, false));
			}
		}

		trSdaPrev = trSda;
		trSda = trs_get_next(chSda);
		trScl = trs_get_next(chScl);

		noiseSda = check_noise(trSdaPrev, trSda);

		if (noiseSda == true)
		{
			i2cObjectsArr.push(new I2cObject(I2COBJECT_TYPE.NOISE, I2C_NOISE.SDA, trSda.sample, false, false));

			var trSdaTemp = trSda;

			do
			{
				trSda = trSdaTemp;
				trSdaTemp = trs_get_next(chSda);
			}
			while ((check_noise(trSda, trSdaTemp) == true) && (trs_is_not_last(chSda) != false));

			trSda = trSdaTemp;
		}
	}

	// Find each bit of all data
	trSda = trs_get_first(chSda);
	trScl = trs_get_first(chScl);

	var startStop;
	var nextStartStopPos = 0;
	var byteEndLast = 0;

	do
	{
		startStop = startStopArr.shift();				// Get first START condition
	}
	while (startStop.type != I2COBJECT_TYPE.START);
	
	nextStartStopPos = startStop.start;

	while ((trs_is_not_last(chScl) != false))			// Read data for a whole transfer
	{
		if (abort_requested() == true)					// Allow the user to abort this script
		{
			return false;
		}

		set_progress(100 * trScl.sample / n_samples);	// Give feedback to ScanaStudio about decoding progress

		trScl = trs_go_after(chScl, nextStartStopPos);	// We must begin right after the START / STOP condition

		i2cObjectsArr.push(startStop);					// Push all in the global array we'll decode all of this in the main decode function
		
		if (startStopArr.length > 0)
		{
			startStop = startStopArr.shift();			// Get next START / STOP condition
			nextStartStopPos = startStop.start;
		}
		else
		{
			startStop = 0;
			nextStartStopPos = n_samples;
		}

		var byteCount = 0;								// Num of bytes received between START / STOP two conditions

		do 												// Read all bits between two START / STOP conditions
		{
			var byteValue = 0;
			var byteStart = false;
			var byteEnd;
			var ack;

			sclSemiPeriod = 0;

			// Interpret those bits as bytes
			for (var i = 0; i < 9; i++)					// For 8 bits data and one ACK bit
			{
				trScl = get_next_rising_edge(chScl, trScl);
				var trSclPrev = trScl;
				trScl = trs_get_next(chScl);

				noiseScl = check_noise(trSclPrev, trScl);

				if (noiseScl == true)
				{
					var trSclTemp = trScl;

					do
					{
						trScl = trSclTemp;
						trSclTemp = trs_get_next(chScl);
					}
					while ((check_noise(trScl, trSclTemp) == true) && (trs_is_not_last(chScl) != false));

					trScl = trSclTemp;
					i2cObjectsArr.push(new I2cObject(I2COBJECT_TYPE.NOISE, I2C_NOISE.SCL, trSclPrev.sample, false, false));
				}

				var newtHigh = trScl.sample - trSclPrev.sample;

				if (trScl != false)												// trScl == false if this is the last transition
				{
					if (nextStartStopPos > trScl.sample)						// While current tr < start/stop tr	
					{
						var bitStart = trSclPrev.sample;
						var bitEnd;

						if ((AvgtHigh * 2) >= newtHigh)							// If High pulse duration on SCL is longer than usually - end of transmisson
						{
							bitEnd = trScl.sample;
						}
						else
						{
							bitEnd = bitStart + (AvgtHigh / 2);
						}

						var midSample = ((bitStart + bitEnd) / 2);
						var bitValue = sample_val(chSda, midSample);		// Read bit value on SCL rising edge

						if (i < 8)												// Only for 8 bits data
						{
							byteValue <<= 1;

							if (bitValue == 1)
							{
								byteValue |= 0x01;
							}

							if(byteStart == false)
							{
								byteStart = bitStart;
							}

							byteEnd = bitEnd;
							dec_item_add_sample_point(chSda, midSample, bitValue ? DRAW_1 : DRAW_0);
						}
						else	// ACK bit
						{
							ack = new I2cObject(I2COBJECT_TYPE.ACK, bitValue, bitStart, bitEnd, false);
						}
					}
					else
					{
						break;
					}
				}
				else
				{
					break;
				}
			}

			if (byteEnd > byteEndLast)
			{
				byteCount++;
	
				i2cObjectsArr.push(new I2cObject(I2COBJECT_TYPE.BYTE, byteValue, byteStart, byteEnd, byteCount));

				if (ack)
				{
					i2cObjectsArr.push(ack);
				}
				else
				{
					ack = new I2cObject(I2COBJECT_TYPE.ACK, 2, bitStart, bitEnd, false);
					i2cObjectsArr.push(ack);
				}

				ack = 0;
				byteEndLast = byteEnd;
			}

		} while (nextStartStopPos > trScl.sample);
	}

	if (startStop.start < n_samples)
	{
		i2cObjectsArr.push(startStop);
	}

	decode_invalid_data();
	return true;
}

/*
*/
function decode_invalid_data()
{
	var trSda = trs_get_first(chSda);
	var trCnt = 0;
	var startCnt = 0;
	var stopCnt = 0;
	var endInvalidData = n_samples;
	var showInvalidData = false;
	var i2cObjCnt = 0;

	if (i2cObjectsArr.length > 0)
	{
		while (i2cObjectsArr.length > i2cObjCnt)
		{
			if ((i2cObjectsArr[i2cObjCnt].type == I2COBJECT_TYPE.START) || 
			    (i2cObjectsArr[i2cObjCnt].type == I2COBJECT_TYPE.STOP))
			{
				endInvalidData = (i2cObjectsArr[i2cObjCnt].start - (AvgtHigh * 2));
				break;
			}

			i2cObjCnt++;
		}
	}

	while ((trs_is_not_last(chSda)) && (trSda.sample < endInvalidData))
	{
		trSda = trs_get_next(chSda);
		trCnt++;

		if (trCnt > 2)
		{
			showInvalidData = true;
			break;
		}
	}

	if (showInvalidData)
	{
		dec_item_new(chSda, 0, endInvalidData);
		dec_item_add_pre_text("NO START - INVALID DATA");
		dec_item_add_pre_text("INVALID DATA");
		dec_item_add_pre_text("INVALID");
	}
}


/* Test if there is a I2C signal
*/
function test_signal()
{
	var trSda = trs_get_first(chSda);
	var trScl = trs_get_first(chScl);
	var valScl;

	var trCnt = 0;
	var startCnt = 0;
	var stopCnt = 0;
	var maxTrCnt = 100000;

	if (n_samples > 100000000)
	{
		maxTrCnt = maxTrCnt / 2;

		if (n_samples > 10000000000)
		{
			maxTrCnt = maxTrCnt / 2;
		}
	}

	while (trs_is_not_last(chSda) != false)
	{
		valScl = sample_val(chScl, trSda.sample);

		if (valScl == 1)
		{
			if (trSda.val == FALLING)
			{
				startCnt++;
			}
			else
			{
				stopCnt++;
			}
		}

		trSda = trs_get_next(chSda);
		trCnt++;

		if (trCnt > maxTrCnt)
		{
			break;
		}
	}

	if (trCnt < 5)
	{
		return I2C_ERR_CODES.NO_SIGNAL;
	}
	else
	{
		if (startCnt >= 1)
		{
			return I2C_ERR_CODES.OK;
		}
		else
		{
			return I2C_ERR_CODES.ERR_SIGNAL;	
		}
	}
}


/*
*/
function int_to_str_hex (num) 
{
	var temp = "0x";

	if (num < 0x10)
	{
		temp += "0";
	}

	temp += num.toString(16).toUpperCase();

	return temp;
}


/*
*/
function get_ch_light_color (k)
{
    var chColor = get_ch_color(k);

    chColor.r = (chColor.r * 1 + 255 * 3) / 4;
	chColor.g = (chColor.g * 1 + 255 * 3) / 4;
	chColor.b = (chColor.b * 1 + 255 * 3) / 4;

	return chColor;
}


/*
*/
function check_scanastudio_support()
{
    if (typeof(pkt_start) != "undefined")
    { 
        return true;
    }
    else
    {
        return false;
    }
}


/*
*/
function add_pkt_data (start, end, str, strLen)
{
	var pktDataPerLine = 10;

	if (strLen > pktDataPerLine)
	{
		var strArr = str.split(" ", pktDataPerLine);
		var strTemp = strArr.toString();
		strTemp = strTemp.replace(/,/g, " ");
		strTemp += " ...";

		pkt_add_item(start, end, "DATA", strTemp, PKT_COLOR_DATA_TITLE, PKT_COLOR_DATA, true);

		strArr = str.split(" ");

		for (var i = pktDataPerLine - 1; i < strArr.length; i += pktDataPerLine)
		{
			strArr[i] += "\n";
		}

		strTemp = strArr.toString();
		strTemp = strTemp.replace(/,/g, " ");

		pkt_start("DATA");
		pkt_add_item(start, end, "DATA", strTemp, PKT_COLOR_DATA_TITLE, PKT_COLOR_DATA, true);
		pkt_end();

	}
	else
	{
		pkt_add_item(start, end, "DATA", str, PKT_COLOR_DATA_TITLE, PKT_COLOR_DATA, true);
	}
}


/* Get next transition with falling edge
*/
function get_next_falling_edge (ch, trSt)
{
	var tr = trSt;

	while ((tr.val != FALLING) && (trs_is_not_last(ch) == true))
	{
		tr = trs_get_next(ch);	// Get the next transition
	}

	if (trs_is_not_last(ch) == false) tr = false;

	return tr;
}


/*	Get next transition with rising edge
*/
function get_next_rising_edge (ch, trSt)
{
	var tr = trSt;

	while ((tr.val != RISING) && (trs_is_not_last(ch) == true))
	{
		tr = trs_get_next(ch);	// Get the next transition
	}

	if (trs_is_not_last(ch) == false) tr = false;

	return tr;
}


/*
*/
function get_avg_thigh (trSt)
{
	var tr = trSt;
	var trPrev = tr;

	var tHighArr = new Array();
	var avgtHigh = 0;

	while (trs_is_not_last(chScl) != false)
	{
		trPrev = tr;
		tr = trs_get_next(chScl);
		tHighArr.push((tr.sample - trPrev.sample));
	
		if (tHighArr.length > 100)
		{
			break;
		}
	}

	tHighArr.sort(function(a, b){return a - b;});
	avgtHigh = tHighArr[Math.round(tHighArr.length / 2)];

	return avgtHigh;
}


/* Get time difference in microseconds between two transitions
*/
function get_tr_diff_us (tr1, tr2)
{
	var diff;

	if (tr1.sample > tr2.sample)
	{
		diff = (((tr1.sample - tr2.sample) * 1000000) / sample_rate);
	}
	else
	{
		diff = (((tr2.sample - tr1.sample) * 1000000) / sample_rate);
	}

	return diff
}


/*
*/
function check_noise (tr1, tr2)
{
	var diff;
	var t;

	if (tr1.sample > tr2.sample)
	{
		diff = tr1.sample - tr2.sample;
	}
	else
	{
		diff = tr2.sample - tr1.sample;
	}

	t = diff * (1 / sample_rate);

	if (t <= I2C_MIN_T)
	{
		return true;
	}

	return false;
}


var samples_per_scl_cycle;


function build_demo_signals()
{
	var inter_transaction_silence = n_samples/100;
	samples_per_scl_cycle = (get_sample_rate()/100000)/2; //samples per half SCL cycle
	//add_to_err_log("samples_per_scl_cycle = "+ samples_per_scl_cycle);
	//add_to_err_log("scl = " + chScl);
	//add_to_err_log("SDA = " + chSda);
	//add some delay		
	add_samples(chScl,1,samples_per_scl_cycle*10);
	add_samples(chSda,1,samples_per_scl_cycle*10);
	
	add_samples(chSda,1,samples_per_scl_cycle/10); //delay chSda wrt chScl by 1/10 of scl cycle.
	
//	return;
	var demo_cnt = 0;
	while((get_samples_acc(chSda) < n_samples) && (get_samples_acc(chScl) < n_samples))
	{				
		
		put_c(0xA2,true,true,false);
		put_c(demo_cnt,false,true,false);
		put_c(0xA3,true,true,false);
		var test_data;
		for (test_data = 0; test_data < 10; test_data++)
		{
			put_c(test_data,false,true,false);
		}
		put_c(test_data,false,false,true);
		demo_cnt++;
		
		//add_samples(chScl,1,samples_per_scl_cycle*20);
		add_samples(chScl,1,inter_transaction_silence);
		//add_samples(chSda,1,samples_per_scl_cycle*20);
		add_samples(chSda,1,inter_transaction_silence);
	}
}

function put_c(data,start,gen_ack,stop)
{

	var i,b;
	
	if (start == true)
	{		
		add_samples(chScl,0,samples_per_scl_cycle);
		add_samples(chSda,0,samples_per_scl_cycle);	
		add_samples(chScl,0,samples_per_scl_cycle);
		add_samples(chSda,1,samples_per_scl_cycle);	
		add_samples(chScl,1,samples_per_scl_cycle);
		add_samples(chSda,0,samples_per_scl_cycle);	
		add_samples(chScl,0,samples_per_scl_cycle);
		add_samples(chSda,0,samples_per_scl_cycle);
	}
	for (i=0; i < 8; i++)
	{
		b = ((data >> (7-i)) & 0x1);
		add_samples(chScl,0,samples_per_scl_cycle);
		add_samples(chSda,b,samples_per_scl_cycle);
		add_samples(chScl,1,samples_per_scl_cycle);
		add_samples(chSda,b,samples_per_scl_cycle);
	}
	if (gen_ack == true)
	{		
		add_samples(chScl,0,samples_per_scl_cycle);
		add_samples(chSda,0,samples_per_scl_cycle);
		add_samples(chScl,1,samples_per_scl_cycle);
		add_samples(chSda,0,samples_per_scl_cycle);							
		add_samples(chScl,0,samples_per_scl_cycle);
		add_samples(chSda,0,samples_per_scl_cycle);
//		add_samples(chScl,1,samples_per_scl_cycle);
//		add_samples(chSda,0,samples_per_scl_cycle);
				
	}
	else
	{
		add_samples(chScl,0,samples_per_scl_cycle);
		add_samples(chSda,1,samples_per_scl_cycle);
		add_samples(chScl,1,samples_per_scl_cycle);
		add_samples(chSda,1,samples_per_scl_cycle);
		add_samples(chScl,0,samples_per_scl_cycle);
		add_samples(chSda,0,samples_per_scl_cycle);		
//		add_samples(chScl,1,samples_per_scl_cycle);
//		add_samples(chSda,0,samples_per_scl_cycle);				
	}
	if (stop == true)
	{		
		add_samples(chScl,1,samples_per_scl_cycle);
		add_samples(chSda,0,samples_per_scl_cycle);	
		add_samples(chScl,1,samples_per_scl_cycle);
		add_samples(chSda,1,samples_per_scl_cycle);	
	}
}

function trig_gui()
{
	trig_ui_clear();
	trig_ui_add_alternative("ALT_ANY_FRAME","Trigger on a any frame",false);
		trig_ui_add_combo("trig_frame_type","Trigger on:");
		trig_ui_add_item_to_combo("Valid Start condition", true);
		trig_ui_add_item_to_combo("Valid Stop condition");
		trig_ui_add_item_to_combo("Any UnAcknowledged address");
		trig_ui_add_item_to_combo("Any Acknowledged address");
		trig_ui_add_item_to_combo("test");
	trig_ui_add_alternative("ALT_SPECIFIC_ADD","Trigger on I2C address",true);
		trig_ui_add_label("lab1","Type Decimal value (65) or HEX value (0x41). Address is an 8 bit field containing the R/W Flag");
		trig_ui_add_free_text("trig_add","Slave Address: ");
		trig_ui_add_check_box("ack_needed_a","Address must be aknowledged by a slave",true);
	/*trig_ui_add_alternative("ALT_SPECIFIC_BYTE","Trigger on I2C data byte",false);
		trig_ui_add_label("lab2","Type decimal value (65), Hex value (0x41) or ACII character between apostrophe marks ('A')");
		trig_ui_add_free_text("trig_byte","Data byte: ");	
		trig_ui_add_check_box("ack_needed_d","Data byte must be aknowledged",true);*/
}

function trig_seq_gen()
{
	get_ui_vals();
	var i2c_step = {sda: "", scl:""};
	var i;
	i2c_trig_steps.length = 0; //clear array
	
	if (ALT_ANY_FRAME == true)
	{
		switch(trig_frame_type)
		{
			case 0: //trig on start
				i2c_step.sda = "F";
				i2c_step.scl = "1";
				i2c_trig_steps.push(new i2c_trig_step_t(i2c_step.sda,i2c_step.scl));	
				flexitrig_set_summary_text("Trig on I2C start condition");
				break;
			case 1: //trig on stop
				i2c_step.sda = "R";
				i2c_step.scl = "1";
				i2c_trig_steps.push(new i2c_trig_step_t(i2c_step.sda,i2c_step.scl));	
				flexitrig_set_summary_text("Trig on I2C start condition");
				break;
			break;
			case 2: // trig on NACK
				i2c_step.sda = "F";
				i2c_step.scl = "1";
				i2c_trig_steps.push(new i2c_trig_step_t(i2c_step.sda,i2c_step.scl));
				//add address and R/W field
				for (i = 7; i >= 0; i--)
				{
					i2c_step.sda = "X"; //any address read or write!
					i2c_step.scl = "R";
					i2c_trig_steps.push(new i2c_trig_step_t(i2c_step.sda,i2c_step.scl));
				}
				i2c_step.sda = "1"; //NACK
				i2c_step.scl = "R";
				i2c_trig_steps.push(new i2c_trig_step_t(i2c_step.sda,i2c_step.scl));				
			break;
			case 3: // trig on ACK
				i2c_step.sda = "F";
				i2c_step.scl = "1";
				i2c_trig_steps.push(new i2c_trig_step_t(i2c_step.sda,i2c_step.scl));
				//add address and R/W field
				for (i = 7; i >= 0; i--)
				{
					i2c_step.sda = "X"; //any address read or write!
					i2c_step.scl = "R";
					i2c_trig_steps.push(new i2c_trig_step_t(i2c_step.sda,i2c_step.scl));
				}
				i2c_step.sda = "0"; //ACK
				i2c_step.scl = "R";
				i2c_trig_steps.push(new i2c_trig_step_t(i2c_step.sda,i2c_step.scl));
			break;	
			case 4: // teest
				i2c_step.sda = "F";
				i2c_step.scl = "1";
				i2c_trig_steps.push(new i2c_trig_step_t(i2c_step.sda,i2c_step.scl));
				
				/*i2c_step.sda = "0"; 
				i2c_step.scl = "F";
				i2c_trig_steps.push(new i2c_trig_step_t(i2c_step.sda,i2c_step.scl));
				*/
				//add address and R/W field
				/*for (i = 3; i >= 0; i--)
				{
					i2c_step.sda = "X"; //any address read or write!
					i2c_step.scl = "R";
					i2c_trig_steps.push(new i2c_trig_step_t(i2c_step.sda,i2c_step.scl));
				}*/
				/*
				i2c_step.sda = "0"; //ACK
				i2c_step.scl = "R";
				i2c_trig_steps.push(new i2c_trig_step_t(i2c_step.sda,i2c_step.scl));
				*/
				
				flexitrig_clear();
				flexitrig_append("XX1F",-1,-1);
				flexitrig_append("XXF0",-1,-1);				
				flexitrig_set_summary_text("TEST");
				return;
				
			break;					
		}
	}
	else if (ALT_SPECIFIC_ADD == true)
	{
		trig_add = Number(trig_add);
		//add the start condition
		i2c_step.sda = "F";
		i2c_step.scl = "1";
		i2c_trig_steps.push(new i2c_trig_step_t(i2c_step.sda,i2c_step.scl));
		//add address and R/W field
		for (i = 7; i >= 0; i--)
		{
			i2c_step.sda = ((trig_add >> i) & 0x1).toString();
			i2c_step.scl = "R";
			i2c_trig_steps.push(new i2c_trig_step_t(i2c_step.sda,i2c_step.scl));
		}
		
		//add ACK field (if needed)
		if (ack_needed_a == true)
		{
			i2c_step.sda = "0";
			i2c_step.scl = "R";
			i2c_trig_steps.push(new i2c_trig_step_t(i2c_step.sda,i2c_step.scl));
		}
		flexitrig_set_summary_text("Trig on I2C Add: 0x" + trig_add.toString(16));
		
	}
	else if (ALT_SPECIFIC_BYTE == true)
	{
		//not implemented for now.
	}
	
	//Now actualy build flexitrig array:
	flexitrig_clear();
	for (i = 0; i < i2c_trig_steps.length; i++)
	{
		flexitrig_append(build_step(i2c_trig_steps[i]),-1,-1);
	}
}

function build_step(i2c_s)
{
	var step = "";
	var i;
	var step_ch_desc;
	
	for (i = 0; i < get_device_max_channels(); i++)
	{	
		if (i == chSda)
		{
			step = i2c_s.sda + step;
		}
		else if (i == chScl)
		{
			step = i2c_s.scl + step;
		}
		else
		{
			step = "X" + step;
		}
	}
	return step;
}




